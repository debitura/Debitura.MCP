/**
 * Country input for the open (keyless) tools (DEB-9129): resolve what a user or
 * an assistant typed to an ISO 3166-1 alpha-2 code, and find the website's
 * country page for it.
 */

const DISPLAY_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

/**
 * Region codes Intl knows that are not current ISO 3166-1 countries: withdrawn
 * codes, groupings and test codes. Without this list "UK" or "SU" would resolve.
 */
const NOT_A_COUNTRY = new Set([
  "AN",
  "BU",
  "CS",
  "CT",
  "DD",
  "DY",
  "EU",
  "EZ",
  "FX",
  "HV",
  "JT",
  "MI",
  "NH",
  "NQ",
  "NT",
  "PC",
  "PU",
  "PZ",
  "QO",
  "RH",
  "SU",
  "TP",
  "UK",
  "UN",
  "VD",
  "WK",
  "XA",
  "XB",
  "YD",
  "YU",
  "ZR",
  "ZZ",
]);

/** Common English names Intl does not use (it says "Türkiye", "Czechia", …). */
const ALIASES: Record<string, string> = {
  usa: "US",
  "united states of america": "US",
  uk: "GB",
  "great britain": "GB",
  england: "GB",
  turkey: "TR",
  "czech republic": "CZ",
  "ivory coast": "CI",
  holland: "NL",
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const BY_CODE = new Map<string, string>();
const BY_NAME = new Map<string, string>();
for (let i = 0; i < 26 * 26; i++) {
  const code = String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26));
  if (NOT_A_COUNTRY.has(code)) continue;
  let name: string | undefined;
  try {
    name = DISPLAY_NAMES.of(code);
  } catch {
    continue;
  }
  if (!name || name === code) continue;
  BY_CODE.set(code, name);
  BY_NAME.set(normalize(name), code);
}
for (const [alias, code] of Object.entries(ALIASES)) BY_NAME.set(alias, code);

export interface ResolvedCountry {
  alpha2: string;
  name: string;
}

/**
 * Resolve a two-letter code or an English country name, case-insensitively.
 * Returns undefined for anything else; callers ask for the two-letter code.
 */
export function resolveCountry(input: string | undefined | null): ResolvedCountry | undefined {
  if (typeof input !== "string" || input.length > 100) return undefined;
  const key = normalize(input);
  if (!key) return undefined;
  const code = ALIASES[key] ?? (key.length === 2 ? key.toUpperCase() : BY_NAME.get(key));
  if (!code) return undefined;
  const name = BY_CODE.get(code);
  return name ? { alpha2: code, name } : undefined;
}

const COUNTRY_PAGE_BASE = "https://www.debitura.com/countries/debt-collection-agency-";

/**
 * Alpha-2 → slug of the country pages on www.debitura.com. Generated from
 * https://www.debitura.com/sitemap.xml on 2026-11-25 (175 pages). A country
 * without a page gets no link; add a line when the website adds a page.
 */
const COUNTRY_PAGE_SLUGS: Record<string, string> = {
  AD: "andorra",
  AE: "united-arab-emirates",
  AF: "afghanistan",
  AL: "albania",
  AM: "armenia",
  AO: "angola",
  AR: "argentina",
  AS: "american-samoa",
  AT: "austria",
  AU: "australia",
  AZ: "azerbaijan",
  BA: "bosnia-and-herzegovina",
  BB: "barbados",
  BD: "bangladesh",
  BE: "belgium",
  BF: "burkina-faso",
  BG: "bulgaria",
  BH: "bahrain",
  BI: "burundi",
  BJ: "benin",
  BM: "bermuda",
  BN: "brunei",
  BO: "bolivia",
  BR: "brazil",
  BS: "bahamas",
  BT: "bhutan",
  BW: "botswana",
  BZ: "belize",
  CA: "canada",
  CF: "central-african-republic",
  CG: "congo",
  CH: "switzerland",
  CI: "cote-divoire",
  CL: "chile",
  CM: "cameroon",
  CN: "china",
  CO: "colombia",
  CR: "costa-rica",
  CY: "cyprus",
  CZ: "czechia",
  DE: "germany",
  DJ: "djibouti",
  DM: "dominica",
  DO: "dominican-republic",
  DZ: "algeria",
  EC: "ecuador",
  EE: "estonia",
  EG: "egypt",
  ES: "spain",
  ET: "ethiopia",
  FI: "finland",
  FJ: "fiji",
  FO: "faroe-islands",
  FR: "france",
  GA: "gabon",
  GB: "united-kingdom",
  GD: "grenada",
  GE: "georgia",
  GH: "ghana",
  GI: "gibraltar",
  GM: "gambia",
  GN: "guinea",
  GQ: "equatorial-guinea",
  GR: "greece",
  GT: "guatemala",
  GU: "guam",
  GW: "guinea-bissau",
  GY: "guyana",
  HK: "hong-kong",
  HN: "honduras",
  HR: "croatia",
  HT: "haiti",
  HU: "hungary",
  ID: "indonesia",
  IE: "ireland",
  IL: "israel",
  IM: "isle-of-man",
  IN: "india",
  IQ: "iraq",
  IS: "iceland",
  IT: "italy",
  JM: "jamaica",
  JO: "jordan",
  JP: "japan",
  KE: "kenya",
  KG: "kyrgyzstan",
  KH: "cambodia",
  KR: "south-korea",
  KW: "kuwait",
  KZ: "kazakhstan",
  LB: "lebanon",
  LI: "liechtenstein",
  LK: "sri-lanka",
  LR: "liberia",
  LT: "lithuania",
  LU: "luxembourg",
  LV: "latvia",
  LY: "libya",
  MA: "morocco",
  MC: "monaco",
  MD: "moldova",
  ME: "montenegro",
  MG: "madagascar",
  MK: "macedonia",
  ML: "mali",
  MN: "mongolia",
  MO: "macao",
  MT: "malta",
  MU: "mauritius",
  MV: "maldives",
  MX: "mexico",
  MY: "malaysia",
  MZ: "mozambique",
  NA: "namibia",
  NE: "niger",
  NG: "nigeria",
  NI: "nicaragua",
  NL: "netherlands",
  NO: "norway",
  NP: "nepal",
  NZ: "new-zealand",
  OM: "oman",
  PA: "panama",
  PE: "peru",
  PF: "french-polynesia",
  PG: "papua-new-guinea",
  PH: "philippines",
  PK: "pakistan",
  PL: "poland",
  PR: "puerto-rico",
  PS: "palestine",
  PT: "portugal",
  PW: "palau",
  PY: "paraguay",
  QA: "qatar",
  RO: "romania",
  RS: "serbia",
  RW: "rwanda",
  SA: "saudi-arabia",
  SC: "seychelles",
  SD: "sudan",
  SE: "sweden",
  SG: "singapore",
  SI: "slovenia",
  SK: "slovakia",
  SL: "sierra-leone",
  SM: "san-marino",
  SN: "senegal",
  SO: "somalia",
  SS: "south-sudan",
  SV: "el-salvador",
  TD: "chad",
  TG: "togo",
  TH: "thailand",
  TJ: "tajikistan",
  TM: "turkmenistan",
  TN: "tunisia",
  TO: "tonga",
  TR: "turkey",
  TT: "trinidad-and-tobago",
  TW: "taiwan",
  TZ: "tanzania",
  UA: "ukraine",
  UG: "uganda",
  US: "united-states",
  UY: "uruguay",
  UZ: "uzbekistan",
  VE: "venezuela",
  VG: "virgin-islands-british",
  VI: "virgin-islands-u-s",
  VN: "vietnam",
  YE: "yemen",
  ZA: "south-africa",
  ZM: "zambia",
  ZW: "zimbabwe",
};

/** The website's page for this country, or undefined when there is none. */
export function countryPageUrl(alpha2: string): string | undefined {
  const slug = COUNTRY_PAGE_SLUGS[alpha2];
  return slug ? COUNTRY_PAGE_BASE + slug : undefined;
}
