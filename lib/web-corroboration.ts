export type ExactWebMatch = {
  url: string;
  title: string | null;
  source: 'site_crawl' | 'google_cse';
  exactInSnippet: boolean;
  exactOnPage: boolean;
};

export type ExactWebEvidence = {
  searched: boolean;
  exactFound: boolean;
  provider: string;
  queries: string[];
  matches: ExactWebMatch[];
  checkedPages: number;
  notes: string[];
};

const UA = 'VerifyMailX/6.2 (+public-email-corroboration)';

function timeoutMs() { return Math.max(1500, Number(process.env.EXACT_WEB_TIMEOUT_MS || 7000)); }
function maxPages() { return Math.max(3, Math.min(60, Number(process.env.EXACT_WEB_MAX_PAGES || 25))); }

async function fetchText(url: string): Promise<{ ok:boolean; text:string; finalUrl:string; title:string|null }> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs());
  try {
    const r = await fetch(url, { redirect:'follow', signal:c.signal, headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5'} });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || (!ct.includes('text') && !ct.includes('xml') && !ct.includes('html'))) return {ok:false,text:'',finalUrl:r.url||url,title:null};
    const text = (await r.text()).slice(0, 2_000_000);
    const m = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return {ok:true,text,finalUrl:r.url||url,title:m ? m[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,240) : null};
  } catch { return {ok:false,text:'',finalUrl:url,title:null}; }
  finally { clearTimeout(t); }
}

function containsExact(text:string,email:string){ return text.toLowerCase().includes(email.toLowerCase()); }
function xmlLocs(xml:string){ return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(m=>m[1].replace(/&amp;/g,'&').trim()).filter(Boolean); }

async function companySiteCrawl(email:string, domain:string): Promise<{matches:ExactWebMatch[];checked:number;notes:string[]}> {
  if (process.env.EXACT_WEB_SITE_CRAWL === 'false') return {matches:[],checked:0,notes:['First-party site crawl disabled.']};
  const origins = [`https://${domain}`, `https://www.${domain}`];
  const notes:string[]=[]; const matches:ExactWebMatch[]=[]; let checked=0;
  const pageUrls:string[]=[]; const sitemapQueue:string[]=[]; const sitemapSeen=new Set<string>();

  for(const origin of origins){
    const home=await fetchText(origin+'/'); checked++;
    if(home.ok&&containsExact(home.text,email)) matches.push({url:home.finalUrl,title:home.title,source:'site_crawl',exactInSnippet:false,exactOnPage:true});
    sitemapQueue.push(origin+'/sitemap.xml',origin+'/sitemap_index.xml');
  }

  while(sitemapQueue.length && sitemapSeen.size<12){
    const url=sitemapQueue.shift()!; if(sitemapSeen.has(url))continue; sitemapSeen.add(url);
    const r=await fetchText(url); checked++; if(!r.ok)continue;
    if(containsExact(r.text,email)) matches.push({url:r.finalUrl,title:r.title,source:'site_crawl',exactInSnippet:false,exactOnPage:true});
    for(const loc of xmlLocs(r.text)){
      try{
        const u=new URL(loc); if(!(u.hostname===domain||u.hostname===`www.${domain}`))continue;
        if(/\.xml(?:$|\?)/i.test(u.pathname+u.search)||/sitemap/i.test(u.pathname)) sitemapQueue.push(u.toString());
        else pageUrls.push(u.toString());
      }catch{}
    }
  }

  for(const url of [...new Set(pageUrls)].slice(0,maxPages())){
    const r=await fetchText(url); checked++; if(!r.ok)continue;
    if(containsExact(r.text,email)) matches.push({url:r.finalUrl,title:r.title,source:'site_crawl',exactInSnippet:false,exactOnPage:true});
  }
  if(!matches.length)notes.push(`No literal exact-email occurrence found in ${checked} first-party resources/pages checked.`);
  return {matches,checked,notes};
}

async function googleCse(email:string,domain:string): Promise<{matches:ExactWebMatch[];queries:string[];checked:number;notes:string[]}> {
  const key=process.env.GOOGLE_CSE_API_KEY?.trim();
  const cx=process.env.GOOGLE_CSE_ID?.trim();
  if(!key||!cx) return {matches:[],queries:[],checked:0,notes:['Google Programmable Search is not configured.']};
  const queries=[`"${email}"`,`"${email}" site:${domain}`];
  const found=new Map<string,ExactWebMatch>(); let checked=0;
  for(const q of queries){
    const u=new URL('https://customsearch.googleapis.com/customsearch/v1');
    u.searchParams.set('key',key);u.searchParams.set('cx',cx);u.searchParams.set('q',q);u.searchParams.set('num','10');u.searchParams.set('fields','items(title,link,snippet,htmlSnippet)');
    const c=new AbortController();const t=setTimeout(()=>c.abort(),timeoutMs());
    try{
      const r=await fetch(u,{signal:c.signal}); if(!r.ok) continue; const data:any=await r.json();
      for(const item of data.items||[]){
        const link=String(item.link||'');if(!/^https?:\/\//.test(link))continue;
        const snippet=`${item.snippet||''} ${item.htmlSnippet||''}`;const exactInSnippet=containsExact(snippet,email);
        let exactOnPage=false; if(exactInSnippet){ exactOnPage=true; } else if(checked<12){ const p=await fetchText(link);checked++; exactOnPage=p.ok&&containsExact(p.text,email); }
        if(exactInSnippet||exactOnPage) found.set(link,{url:link,title:item.title||null,source:'google_cse',exactInSnippet,exactOnPage});
      }
    }catch{} finally{clearTimeout(t)}
  }
  return {matches:[...found.values()],queries,checked,notes:[]};
}

export async function exactWebCorroboration(email:string): Promise<ExactWebEvidence> {
  const clean=email.trim().toLowerCase(); const domain=clean.split('@')[1]||'';
  if(!clean.includes('@')||!domain) return {searched:false,exactFound:false,provider:'none',queries:[],matches:[],checkedPages:0,notes:['Invalid email for web corroboration.']};
  const site=await companySiteCrawl(clean,domain);
  const google=await googleCse(clean,domain);
  const all=new Map<string,ExactWebMatch>(); for(const m of [...site.matches,...google.matches]) all.set(m.url,m);
  const providers=[]; if(site.checked)providers.push('first-party site crawl'); if(google.queries.length)providers.push('Google Programmable Search');
  return {searched:true,exactFound:all.size>0,provider:providers.join(' + ')||'first-party site crawl',queries:google.queries,matches:[...all.values()].slice(0,16),checkedPages:site.checked+google.checked,notes:[...site.notes,...google.notes]};
}
