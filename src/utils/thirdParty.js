// Heuristic list of ad/tracking/analytics hosts whose stylesheets are not
// considered part of the site's own authored CSS. This is intentionally
// small and conservative — CDN-hosted fonts/frameworks (googleapis,
// cloudflare, jsdelivr, unpkg, bootstrapcdn, ...) are NOT excluded, since a
// site author deliberately included those as part of their own styling.
const AD_TRACKING_HOST_PATTERNS = [
  /(^|\.)doubleclick\.net$/,
  /(^|\.)googlesyndication\.com$/,
  /(^|\.)googletagmanager\.com$/,
  /(^|\.)googletagservices\.com$/,
  /(^|\.)google-analytics\.com$/,
  /(^|\.)adservice\.google\.com$/,
  /(^|\.)taboola\.com$/,
  /(^|\.)outbrain\.com$/,
  /(^|\.)criteo\.(com|net)$/,
  /(^|\.)facebook\.(com|net)$/,
  /(^|\.)connect\.facebook\.net$/,
  /(^|\.)adroll\.com$/,
  /(^|\.)quantserve\.com$/,
  /(^|\.)scorecardresearch\.com$/,
  /(^|\.)hotjar\.com$/,
  /(^|\.)segment\.(com|io)$/,
  /(^|\.)amazon-adsystem\.com$/,
  /(^|\.)adnxs\.com$/,
  /(^|\.)pubmatic\.com$/,
  /(^|\.)rubiconproject\.com$/,
  /(^|\.)media\.net$/,
];

export function isThirdPartyAdOrTracking(hostname) {
  if (!hostname) return false;
  return AD_TRACKING_HOST_PATTERNS.some((re) => re.test(hostname));
}
