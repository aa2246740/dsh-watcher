const SECRET = /((?:token|key|secret|password|authorization|bearer)[^\s:=]{0,24}[:=]\s*)[^\s&]+/gi
const QUERY_SECRET = /([?&](?:token|key|secret|password|auth)=)[^&#\s]+/gi

export function redact(value: unknown): string {
  const text = value instanceof Error ? (value.stack || value.message) : String(value)
  return text.replace(SECRET, '$1[redacted]').replace(QUERY_SECRET, '$1[redacted]')
}

export function logDebug(message: string): void {
  console.debug(redact(message))
}

export function logInfo(message: string): void {
  console.log(redact(message))
}

export function logError(error: unknown): void {
  console.error(redact(error))
}
