const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const REQUEST_ID_HEADER = 'x-request-id';

export function isValidRequestId(value: string): boolean {
  return REQUEST_ID_PATTERN.test(value);
}

export function resolveRequestId(incoming: string | null | undefined): string {
  const candidate = incoming?.trim();
  return candidate && isValidRequestId(candidate) ? candidate : crypto.randomUUID();
}
