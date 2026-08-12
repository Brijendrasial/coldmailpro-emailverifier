import { NextResponse } from 'next/server';
import { aiConfigured, aiModel, aiWebSearchEnabled } from '@/lib/ai-analyzer';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){return NextResponse.json({configured:aiConfigured(),model:aiModel(),webSearchEnabled:aiWebSearchEnabled()});}
