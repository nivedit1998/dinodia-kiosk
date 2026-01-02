// Utility to validate local-only hosts for cleartext HA access.
const privateRanges = [
  /^10\.(\d{1,3}\.){2}\d{1,3}$/,
  /^192\.168\.(\d{1,3})\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[0-1])\.(\d{1,3})\.\d{1,3}$/,
  /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  /^localhost$/i,
  /\.local$/i,
  /\.lan$/i,
];

export function isLocalIp(host: string): boolean {
  return privateRanges.some((re) => re.test(host));
}
