export type SmtpDisposition =
  | 'accepted'
  | 'invalid_mailbox'
  | 'mailbox_full'
  | 'temporary'
  | 'greylisted'
  | 'rate_limited'
  | 'policy_blocked'
  | 'auth_required'
  | 'unknown';

export type SmtpClassification = {
  disposition: SmtpDisposition;
  label: string;
  retryable: boolean;
  explanation: string;
};

export function classifySmtp(code: number | null, message = ''): SmtpClassification {
  const text = message.toLowerCase();
  if (code != null && code >= 200 && code < 300) {
    return { disposition: 'accepted', label: 'Recipient accepted', retryable: false, explanation: 'The receiving SMTP server accepted the recipient during the RCPT TO stage.' };
  }
  if (/5\.1\.1|user unknown|unknown user|no such user|recipient.*not found|mailbox.*not found|does not exist/.test(text)) {
    return { disposition: 'invalid_mailbox', label: 'Mailbox not found', retryable: false, explanation: 'The server response indicates that the recipient mailbox does not exist.' };
  }
  if (/5\.2\.2|mailbox full|quota exceeded|over quota|storage.*full/.test(text) || code === 552) {
    return { disposition: 'mailbox_full', label: 'Mailbox full', retryable: true, explanation: 'The mailbox appears to exist but cannot currently receive more mail.' };
  }
  if (/greylist|try again later|temporarily deferred/.test(text)) {
    return { disposition: 'greylisted', label: 'Greylisted', retryable: true, explanation: 'The remote server temporarily deferred the request and should be retried later.' };
  }
  if (/rate limit|too many|throttl|4\.7\.0|4\.7\.1/.test(text) || code === 421) {
    return { disposition: 'rate_limited', label: 'Rate limited / deferred', retryable: true, explanation: 'The remote server is throttling or temporarily deferring SMTP requests.' };
  }
  if (/authentication required|authenticate first|relay access denied/.test(text)) {
    return { disposition: 'auth_required', label: 'Authentication required', retryable: false, explanation: 'The server refused this SMTP transaction because it requires authentication or does not allow relay-style probing.' };
  }
  if (/5\.7\.|policy|blocked|spam|prohibited|access denied|not permitted/.test(text)) {
    return { disposition: 'policy_blocked', label: 'Policy rejection', retryable: false, explanation: 'The SMTP server rejected the request for policy or reputation reasons; this does not necessarily prove the mailbox is invalid.' };
  }
  if ((code != null && code >= 400 && code < 500) || /temporary|temporarily|defer|timeout/.test(text)) {
    return { disposition: 'temporary', label: 'Temporary failure', retryable: true, explanation: 'The SMTP server returned a temporary failure. Retry later before classifying the mailbox.' };
  }
  return { disposition: 'unknown', label: 'Unclassified SMTP response', retryable: false, explanation: 'The response could not be confidently mapped to a mailbox state.' };
}
