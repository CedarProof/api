import { serveGit } from "./owner-git-repo.ts";
import { publicPaymentSource, publicImportMap } from './public-payment-source.ts';
import { HTTPFacilitatorClient, x402ResourceServer } from "npm:@x402/core@2.27.0/server";
import { ExactEvmScheme } from "npm:@x402/evm@2.27.0/exact/server";
import { ExactNanoScheme } from "npm:@x402nano/exact@0.2.3/server";

const NANO_PRICE = "0.001";
const NANO_FACILITATOR = "https://facilitator.pursekeeper.dev";
const NANO_PAY_TO = "nano_3mr761i87o7o33hmrd67a1emt81j6djgdqeyod95ip5qcidz77b71x4ukqea";
const NANO_NETWORK = "nano:mainnet";

const BASE_PRICE = "$0.01";
const BASE_FACILITATOR = "https://facilitator.payai.network";
const BASE_PAY_TO = "0xf200174de10c26ce7670aaf41d69a8979fe5629d";
const BASE_NETWORK = "eip155:8453";

const PUBLIC_BASE = "https://tkoqkknsezxavtxfywkm.supabase.co/functions/v1/nano-npm-risk";
const PAID = `${PUBLIC_BASE}/v1/npm-risk`;

const nanoServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: NANO_FACILITATOR }))
  .register(NANO_NETWORK, new ExactNanoScheme());
const baseServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: BASE_FACILITATOR }))
  .register(BASE_NETWORK, new ExactEvmScheme());

const nanoInit = nanoServer.initialize();
const baseInit = baseServer.initialize();

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function encodeWire(value: unknown) { return btoa(JSON.stringify(value)); }
function decodeWire(value: string) { try { return JSON.parse(atob(value)); } catch { return null; } }

function validatePackageName(value: string | null) {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || name.length > 214 || /\s/.test(name)) return null;
  if (name.startsWith("@")) return /^@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*$/i.test(name) ? name : null;
  return /^[a-z0-9][a-z0-9._~-]*$/i.test(name) ? name : null;
}

function daysSince(iso: string | null, now: Date) {
  if (!iso) return null;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((now.getTime() - timestamp) / 86_400_000));
}

function repositoryUrl(repository: unknown): string | null {
  if (!repository) return null;
  if (typeof repository === "string") return repository;
  if (typeof repository === "object" && repository !== null && "url" in repository) {
    const value = (repository as { url?: unknown }).url;
    return typeof value === "string" ? value : null;
  }
  return null;
}

async function buildNpmRiskReport(packageName: string | null) {
  const normalized = validatePackageName(packageName);
  if (!normalized) throw Object.assign(new Error("Invalid npm package name"), { statusCode: 400 });
  const encoded = encodeURIComponent(normalized);
  const [metadataResponse, downloadsResponse] = await Promise.all([
    fetch(`https://registry.npmjs.org/${encoded}`, { headers: { accept: "application/json" } }),
    fetch(`https://api.npmjs.org/downloads/point/last-week/${encoded}`, { headers: { accept: "application/json" } }),
  ]);
  if (metadataResponse.status === 404) throw Object.assign(new Error("Package not found"), { statusCode: 404 });
  if (!metadataResponse.ok) throw Object.assign(new Error(`npm registry returned ${metadataResponse.status}`), { statusCode: 502 });
  const metadata = await metadataResponse.json();
  const latestVersion = metadata["dist-tags"]?.latest ?? null;
  const latest = latestVersion ? metadata.versions?.[latestVersion] ?? {} : {};
  const lastPublishedAt = latestVersion ? metadata.time?.[latestVersion] ?? null : null;
  const lastPublishedDaysAgo = daysSince(lastPublishedAt, new Date());
  const maintainers = Array.isArray(metadata.maintainers) ? metadata.maintainers.length : 0;
  const weeklyDownloads = downloadsResponse.ok ? Number((await downloadsResponse.json()).downloads ?? 0) : null;
  const flags: Record<string, unknown>[] = [];
  if (latest.deprecated) flags.push({ code: "deprecated", severity: "high", detail: String(latest.deprecated) });
  if (lastPublishedDaysAgo === null) flags.push({ code: "publish_date_unknown", severity: "medium" });
  else if (lastPublishedDaysAgo > 730) flags.push({ code: "stale_over_2y", severity: "high", days: lastPublishedDaysAgo });
  else if (lastPublishedDaysAgo > 365) flags.push({ code: "stale_over_1y", severity: "medium", days: lastPublishedDaysAgo });
  if (maintainers === 0) flags.push({ code: "no_listed_maintainers", severity: "high" });
  else if (maintainers === 1) flags.push({ code: "single_maintainer", severity: "low" });
  if (weeklyDownloads !== null && weeklyDownloads < 100) flags.push({ code: "low_weekly_downloads", severity: "medium", downloads: weeklyDownloads });
  if (!latest.license && !metadata.license) flags.push({ code: "license_unknown", severity: "medium" });
  if (!repositoryUrl(latest.repository ?? metadata.repository)) flags.push({ code: "repository_missing", severity: "low" });
  const penalty = flags.reduce((total, flag) => total + ({ high: 25, medium: 12, low: 5 }[String(flag.severity)] ?? 0), 0);
  const score = Math.max(0, 100 - penalty);
  return {
    package: normalized,
    latestVersion,
    score,
    verdict: score >= 80 ? "low-obvious-risk" : score >= 55 ? "review" : "high-caution",
    flags,
    evidence: {
      lastPublishedAt,
      lastPublishedDaysAgo,
      weeklyDownloads,
      maintainers,
      license: latest.license ?? metadata.license ?? null,
      repository: repositoryUrl(latest.repository ?? metadata.repository),
    },
    generatedAt: new Date().toISOString(),
    methodology: "Public npm registry metadata and npm weekly download counts; heuristic, not a security audit.",
  };
}

function statusCode(error: unknown, fallback = 500) {
  if (error && typeof error === "object" && "statusCode" in error) {
    const value = Number((error as { statusCode?: unknown }).statusCode);
    if (Number.isInteger(value) && value >= 400 && value <= 599) return value;
  }
  return fallback;
}

async function paymentContext(resourceUrl: string) {
  await Promise.all([nanoInit, baseInit]);
  const nanoRequirements = (await nanoServer.buildPaymentRequirements({
    scheme: "exact", network: NANO_NETWORK, price: NANO_PRICE, payTo: NANO_PAY_TO,
    description: "Evidence-backed npm package health and maintenance-risk report", mimeType: "application/json",
  }))[0];
  const baseRequirements = (await baseServer.buildPaymentRequirements({
    scheme: "exact", network: BASE_NETWORK, price: BASE_PRICE, payTo: BASE_PAY_TO,
    description: "Evidence-backed npm package health and maintenance-risk report", mimeType: "application/json",
  }))[0];
  const required = {
    x402Version: 2,
    resource: {
      url: resourceUrl,
      description: "Evidence-backed npm package health and maintenance-risk report",
      mimeType: "application/json",
      serviceName: "Ops Control HQ npm Package Risk",
      tags: ["npm", "package-risk", "package-health", "maintenance-risk", "developer-tools"],
    },
    accepts: [nanoRequirements, baseRequirements],
  };
  return { nanoRequirements, baseRequirements, required };
}

function selectedNetwork(payload: any): string | null {
  return payload?.accepted?.network ?? payload?.network ?? null;
}


/* Narrow Nano page-extraction lane. Source extraction routines below are copied from
   the independent live page-extract-x402-v1 v28; the old npm-risk route is unchanged. */
const PAGE_PAID = `${PUBLIC_BASE}/v1/page-extract`;
const PAGE_PRICE='0.001'; // XNO, existing Nano facilitator and project-owned wallet
const MAX_BYTES=512_000,MAX_TEXT=50_000,MAX_LINKS=100,MAX_HEADINGS=80,TIMEOUT_MS=8_000,MAX_REDIRECTS=4;
const PAGE_DESCRIPTION='Extract one publicly resolvable HTTPS webpage into clean text, Markdown, headings, links, and title. No JavaScript rendering or paywall bypass. Payment settles only for a successful extraction.';
function isBadHost(h:string){const x=h.toLowerCase().replace(/\.$/,'');return x==='localhost'||x.endsWith('.localhost')||x.endsWith('.local')||x.endsWith('.internal')||x.endsWith('.home')||x.endsWith('.lan')}
function badV4(ip:string){const p=ip.split('.').map(Number);if(p.length!==4||p.some(n=>!Number.isInteger(n)||n<0||n>255))return true;const[a,b,c]=p;return a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===192&&b===0)||(a===192&&b===2)||(a===198&&b>=18&&b<=19)||(a===198&&b===51&&c===100)||(a===203&&b===0&&c===113)}
function badV6(ip:string){const x=ip.toLowerCase();return x==='::1'||x==='::'||x.startsWith('fc')||x.startsWith('fd')||x.startsWith('fe8')||x.startsWith('fe9')||x.startsWith('fea')||x.startsWith('feb')||x.startsWith('2001:db8:')||x.startsWith('::ffff:127.')||x.startsWith('::ffff:10.')||x.startsWith('::ffff:192.168.')}
async function safeUrl(raw:string){
  let u:URL; try{u=new URL(raw)}catch{return null}
  if(u.protocol!=='https:'||u.username||u.password||isBadHost(u.hostname)||(u.port&&u.port!=='443'))return null;
  if(/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname)||u.hostname.includes(':'))return null;
  try{const a=await Deno.resolveDns(u.hostname,'A').catch(()=>[] as string[]);const aaaa=await Deno.resolveDns(u.hostname,'AAAA').catch(()=>[] as string[]);if(a.length===0&&aaaa.length===0)return null;if(a.some(badV4)||aaaa.some(badV6))return null}catch{return null}
  u.hash=''; return u;
}
async function fetchSafe(start:URL){
  let u=start;
  for(let i=0;i<MAX_REDIRECTS;i++){
    let r:Response; try{r=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(TIMEOUT_MS),headers:{'user-agent':'OpsControlHQ-PageExtract/1.1','accept':'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.4'}})}catch(e){throw new Error(e instanceof DOMException&&e.name==='TimeoutError'?'fetch_timeout':'fetch_failed')}
    if([301,302,303,307,308].includes(r.status)){const loc=r.headers.get('location');if(!loc)throw new Error('redirect_without_location');const next=await safeUrl(new URL(loc,u).href);if(!next)throw new Error('unsafe_redirect');u=next;continue}
    if(r.status<200||r.status>=300)throw new Error('upstream_http_'+r.status);
    const len=Number(r.headers.get('content-length')||'0');if(len>MAX_BYTES)throw new Error('response_too_large');
    const reader=r.body?.getReader();const chunks:Uint8Array[]=[];let total=0;
    if(reader){for(;;){const {done,value}=await reader.read();if(done)break;if(value){total+=value.length;if(total>MAX_BYTES){await reader.cancel();throw new Error('response_too_large')}chunks.push(value)}}}
    const all=new Uint8Array(total);let off=0;for(const c of chunks){all.set(c,off);off+=c.length}
    return {response:r,finalUrl:u.href,bytes:all};
  }
  throw new Error('too_many_redirects');
}
function decodeEntities(s:string){return s.replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))}
function stripTags(s:string){return decodeEntities(s.replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim()}
function pageStructure(body:string,base:string){
  const headings:any[]=[];const hr=/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;let m:RegExpExecArray|null;
  while((m=hr.exec(body))&&headings.length<MAX_HEADINGS){const t=stripTags(m[2]);if(t)headings.push({level:Number(m[1]),text:t.slice(0,500)})}
  const links:any[]=[];const seen=new Set<string>();const lr=/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while((m=lr.exec(body))&&links.length<MAX_LINKS){try{const u=new URL(m[1],base);if(u.protocol!=='http:'&&u.protocol!=='https:')continue;u.hash='';const href=u.href;if(seen.has(href))continue;seen.add(href);links.push({text:stripTags(m[2]).slice(0,300)||null,url:href})}catch{}}
  return {headings,links};
}
function cleanText(body:string,ct:string,base:string){
  let title:string|null=null,description:string|null=null,text=body,headings:any[]=[],links:any[]=[];
  if(ct.includes('html')||ct.includes('xhtml')){
    const tm=body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);title=tm?stripTags(tm[1]):null;
    const dm=body.match(/<meta[^>]+(?:name|property)\s*=\s*["'](?:description|og:description)["'][^>]+content\s*=\s*["']([^"']*)["'][^>]*>/i)||body.match(/<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+(?:name|property)\s*=\s*["'](?:description|og:description)["'][^>]*>/i);
    description=dm?decodeEntities(dm[1]).replace(/\s+/g,' ').trim():null;
    const candidates:string[]=[];
    for(const re of [/<article\b[^>]*>([\s\S]*?)<\/article>/ig,/<main\b[^>]*>([\s\S]*?)<\/main>/ig]){
      let m:RegExpExecArray|null;
      while((m=re.exec(body))){if(stripTags(m[1]).length>=200)candidates.push(m[1]);}
    }
    const content=candidates.length?candidates.sort((a,b)=>stripTags(b).length-stripTags(a).length)[0]:body;
    ({headings,links}=pageStructure(content,base));
    text=content.replace(/<!--[\s\S]*?-->/g,' ').replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<noscript\b[\s\S]*?<\/noscript>/gi,' ').replace(/<svg\b[\s\S]*?<\/svg>/gi,' ').replace(/<nav\b[\s\S]*?<\/nav>/gi,' ').replace(/<footer\b[\s\S]*?<\/footer>/gi,' ').replace(/<[^>]+>/g,' ');
  }
  text=decodeEntities(text).replace(/\s+/g,' ').trim();const truncated=text.length>MAX_TEXT;if(truncated)text=text.slice(0,MAX_TEXT);
  return {title,description,text,truncated,headings,links};
}

function makeMarkdown(title:string|null,description:string|null,text:string,headings:any[],links:any[]){
  const parts:string[]=[];
  if(title) parts.push('# '+title);
  if(description) parts.push('> '+description);
  const normalizedTitle=(title||'').trim().toLowerCase();
  const usefulHeadings=headings.filter((h:any)=>String(h?.text||'').trim().toLowerCase()!==normalizedTitle);
  if(usefulHeadings.length){
    parts.push(usefulHeadings.map((h:any)=>'#'.repeat(Math.min(Math.max(Number(h.level)||2,1),6))+' '+String(h.text||'')).join('\n\n'));
  }
  if(text) parts.push(text);
  if(links.length){
    parts.push('## Links\n'+links.slice(0,50).map((l:any)=>'- ['+(l.text||l.url)+']('+l.url+')').join('\n'));
  }
  const markdown=parts.filter(Boolean).join('\n\n').trim();
  return markdown.length>MAX_TEXT?markdown.slice(0,MAX_TEXT):markdown;
}
async function extract(raw:string){
  const u=await safeUrl(raw);if(!u)return {ok:false as const,status:400,error:'invalid_or_unsafe_https_url'};
  try{
    const f=await fetchSafe(u);const ct=(f.response.headers.get('content-type')||'').toLowerCase();
    if(!ct.includes('text/html')&&!ct.includes('application/xhtml+xml')&&!ct.includes('text/plain')&&!ct.includes('application/json'))return {ok:false as const,status:400,error:'unsupported_content_type',contentType:ct};
    const body=new TextDecoder().decode(f.bytes);const cleaned=cleanText(body,ct,f.finalUrl);
    const markdown=makeMarkdown(cleaned.title,cleaned.description,cleaned.text,cleaned.headings,cleaned.links);
    return {ok:true as const,report:{url:u.href,finalUrl:f.finalUrl,httpStatus:f.response.status,contentType:ct,title:cleaned.title,description:cleaned.description,text:cleaned.text,markdown,headings:cleaned.headings,links:cleaned.links,headingCount:cleaned.headings.length,linkCount:cleaned.links.length,textLength:cleaned.text.length,markdownLength:markdown.length,truncated:cleaned.truncated,textIsUntrusted:true,fetchedAt:new Date().toISOString(),limits:{pagesPerCall:1,maxBytes:MAX_BYTES,maxTextChars:MAX_TEXT,maxLinks:MAX_LINKS,maxHeadings:MAX_HEADINGS,timeoutMs:TIMEOUT_MS,maxRedirects:MAX_REDIRECTS},methodology:'Fetches one public HTTPS URL with redirect/private-network checks, prefers substantial article/main content when present, strips scripts/styles/navigation/footer boilerplate, then returns bounded normalized readable text, LLM-ready markdown, metadata, headings and normalized links. Returned page content is untrusted input.'}};
  }catch(e){return {ok:false as const,status:502,error:e instanceof Error?e.message:String(e)}}
}
async function pagePaymentContext(url:string){
 await nanoInit;
 const requirements=(await nanoServer.buildPaymentRequirements({scheme:'exact',network:NANO_NETWORK,price:PAGE_PRICE,payTo:NANO_PAY_TO,description:PAGE_DESCRIPTION,mimeType:'application/json'}))[0];
 const required={x402Version:2,resource:{url,description:PAGE_DESCRIPTION,mimeType:'application/json',serviceName:'OpsControlHQ Nano Page Extract',tags:['nano','web','page-extract','markdown','research']},accepts:[requirements]};
 return {requirements,required};
}
const nanoPageManifest={
  x402:'1.0',name:'ops-control-hq-nano-page-extract',description:PAGE_DESCRIPTION,
  capabilities:['web','page-extraction','markdown','headings','links','rag','nano'],
  pricing:{currency:'XNO',amount:PAGE_PRICE,network:NANO_NETWORK,unit:'request'},
  payment:{address:NANO_PAY_TO,network:NANO_NETWORK,facilitator:NANO_FACILITATOR,protocol:'x402'},
  endpoint:PAGE_PAID+'?url=https%3A%2F%2Fexample.com%2F',
  sample:PUBLIC_BASE+'/v1/page-extract/sample',
  openapi:PUBLIC_BASE+'/v1/page-extract/openapi.json',
  chargedOnFailure:false
};
const nanoPageOpenAPI={
  openapi:'3.1.0',info:{title:'Ops Control HQ Nano Web Page Extraction',version:'1.0.0',description:PAGE_DESCRIPTION+' Operator-produced, AI-assisted service.'},
  servers:[{url:PUBLIC_BASE}],paths:{
    '/v1/page-extract':{get:{
      operationId:'extractPublicHttpsPageWithNano',summary:'Paid Nano webpage extraction',
      parameters:[{name:'url',in:'query',required:true,schema:{type:'string',format:'uri'}}],
      'x-payment-info':{price:{amount:PAGE_PRICE,currency:'XNO'},protocols:[{x402:{network:NANO_NETWORK,payTo:NANO_PAY_TO}}]},
      responses:{'200':{description:'Settled extraction result',content:{'application/json':{schema:{type:'object',properties:{url:{type:'string',format:'uri'},finalUrl:{type:'string',format:'uri'},httpStatus:{type:'integer'},contentType:{type:'string'},title:{type:['string','null']},text:{type:'string'},markdown:{type:'string'},headings:{type:'array',items:{type:'object',properties:{level:{type:'integer'},text:{type:'string'}}}},links:{type:'array',items:{type:'object',properties:{text:{type:['string','null']},url:{type:'string',format:'uri'}}}},truncated:{type:'boolean'},textIsUntrusted:{type:'boolean'},payment:{type:['string','null']}}}}}},'400':{description:'Unsafe URL; not settled'},'402':{description:'Nano x402 payment required'},'502':{description:'Extraction failed; not settled'}}
    }}
  }
};

const manifest = {
  // Public discovery pointers only. Settlement, receiving wallets, prices and npm-risk routes remain unchanged.
  relatedPaidServices: [{
    name: 'Ops Control HQ Nano Web Page Extraction',
    kind: 'public-https-page-extraction',
    endpoint: nanoPageManifest.endpoint,
    discovery: PUBLIC_BASE + '/v1/page-extract/.well-known/x402',
    openapi: PUBLIC_BASE + '/v1/page-extract/openapi.json',
    freeSample: PUBLIC_BASE + '/v1/page-extract/sample',
    price: '0.001 XNO per successful request',
    network: NANO_NETWORK,
    chargedOnFailure: false,
    disclosure: 'Operator-produced, AI-assisted service; no independently audited performance claim.'
  }],
  x402: "1.0",
  name: "ops-control-hq-npm-package-risk",
  description: "Evidence-backed npm package health and maintenance-risk report with dual x402 payment rails: Nano/XNO or Base/USDC.",
  capabilities: ["npm", "package-risk", "package-health", "maintenance-risk", "developer-tools"],
  pricing: {
    options: [
      { currency: "XNO", amount: NANO_PRICE, network: NANO_NETWORK },
      { currency: "USDC", amount: "0.01", network: BASE_NETWORK },
    ],
    unit: "request",
  },
  payment: {
    options: [
      { address: NANO_PAY_TO, network: NANO_NETWORK, facilitator: NANO_FACILITATOR },
      { address: BASE_PAY_TO, network: BASE_NETWORK, facilitator: BASE_FACILITATOR },
    ],
  },
  endpoint: `${PAID}?package=react`,
  sourceCode: `${PUBLIC_BASE}/source/index.ts`,
};

Deno.serve(async (req: Request) => {
  const internalUrl = new URL(req.url);
  const suffix = internalUrl.pathname.replace(/^\/nano-npm-risk/, "");
  const git = await serveGit(req, suffix);
  if (git) return git;

  if (req.method === "GET" && (suffix === "/healthz" || suffix === "/" || suffix === "")) {
    return json({
      ok: true,
      service: "Ops Control HQ npm Package Risk",
      paidRoute: PAID,
      paymentOptions: [
        { network: NANO_NETWORK, price: `${NANO_PRICE} XNO`, facilitator: NANO_FACILITATOR },
        { network: BASE_NETWORK, price: "$0.01 USDC", facilitator: BASE_FACILITATOR },
      ],
      discovery: { x402: `${PUBLIC_BASE}/.well-known/x402`, source: `${PUBLIC_BASE}/source/index.ts` },
    }, 200, { "cache-control": "public,max-age=60" });
  }

  // Read-only mirror of the exact v7 core payment implementation, with v8 only adding these public source routes.
  if (req.method === "GET" && suffix === "/source/index.ts") {
    return new Response(publicPaymentSource, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public,max-age=300", "x-content-type-options": "nosniff" } });
  }
  if (req.method === "GET" && suffix === "/source/deno.json") {
    return new Response(publicImportMap, { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public,max-age=300", "x-content-type-options": "nosniff" } });
  }
  if (req.method === "GET" && suffix === "/source") {
    return json({ source: `${PUBLIC_BASE}/source/index.ts`, importMap: `${PUBLIC_BASE}/source/deno.json`, provenance: "Exact payment-handling source snapshot from live v7; current v8 adds only these read-only source routes and public discovery links. No credentials, paid execution, or payment logic changes." }, 200, { "cache-control": "public,max-age=300" });
  }
  if (req.method === "GET" && suffix === "/.well-known/x402") {
    return json(manifest, 200, { "cache-control": "public,max-age=300" });
  }


  if(req.method==='GET'&&(suffix==='/v1/page-extract/.well-known/x402'||suffix==='/v1/page-extract/.well-known/x402-service.json'))return json(nanoPageManifest,200,{'cache-control':'public,max-age=300'});
  if(req.method==='GET'&&suffix==='/v1/page-extract/openapi.json')return json(nanoPageOpenAPI,200,{'cache-control':'public,max-age=300'});
  if(req.method==='GET'&&suffix==='/v1/page-extract/sample'){
    const sample=await extract('https://example.com/');
    return sample.ok?json({...sample.report,freeSample:true}):json({error:sample.error,freeSample:true},sample.status);
  }
  if(req.method==='GET'&&suffix==='/v1/page-extract/llms.txt')return new Response(
    'Ops Control HQ Nano Page Extraction\\nPaid route: GET '+PAGE_PAID+'?url=https%3A%2F%2Fexample.com%2F\\nPrice: 0.001 XNO per successful extraction (Nano mainnet x402).\\nSafe public HTTPS only; no JS rendering or paywall bypass.\\nSample: '+PUBLIC_BASE+'/v1/page-extract/sample\\nOpenAPI: '+PUBLIC_BASE+'/v1/page-extract/openapi.json\\n',
    {headers:{'content-type':'text/plain; charset=utf-8','cache-control':'public,max-age=300'}}
  );
  if(req.method==='GET'&&suffix==='/v1/page-extract'){
    const fields=internalUrl.searchParams.getAll('url');
    const input=(fields[0]||'').trim();
    if(fields.length!==1||!input||!await safeUrl(input))return json({error:'invalid_or_unsafe_https_url',paymentSettled:false},400);
    let context;
    try{context=await pagePaymentContext(PAGE_PAID+internalUrl.search);}
    catch(e){console.error('NANO_PAGE_PAYMENT_SETUP',e instanceof Error?e.message:String(e));return json({error:'payment_unavailable',paymentSettled:false},503);}
    const header=req.headers.get('PAYMENT-SIGNATURE')||req.headers.get('X-PAYMENT');
    if(!header)return json({error:'payment_required',x402Version:2,price:PAGE_PRICE,currency:'XNO',network:NANO_NETWORK,chargedOnFailure:false,resource:context.required.resource,accepts:context.required.accepts},402,{'PAYMENT-REQUIRED':encodeWire(context.required)});
    const payload=decodeWire(header);
    if(!payload)return json({error:'invalid_payment_encoding',paymentSettled:false},402,{'PAYMENT-REQUIRED':encodeWire(context.required)});
    if(selectedNetwork(payload)!==NANO_NETWORK)return json({error:'unsupported_network',supported:[NANO_NETWORK],paymentSettled:false},402,{'PAYMENT-REQUIRED':encodeWire(context.required)});
    try{
      const verified=await nanoServer.verifyPayment(payload,context.requirements);
      if(!verified.isValid)return json({error:'invalid_payment',reason:verified.invalidReason,paymentSettled:false},402);
      const result=await extract(input);
      if(!result.ok)return json({error:result.error,paymentSettled:false},result.status);
      const settled=await nanoServer.settlePayment(payload,context.requirements);
      if(!settled.success)return json({error:'settlement_failed',reason:settled.errorReason,paymentSettled:false},402);
      console.log('NANO_PAGE_EXTRACT_SETTLED',JSON.stringify({transaction:settled.transaction??null,at:new Date().toISOString()}));
      return json({...result.report,payment:settled.transaction??null,paymentNetwork:NANO_NETWORK},200,{'PAYMENT-RESPONSE':encodeWire(settled)});
    }catch(e){console.error('NANO_PAGE_EXTRACT_ERROR',e instanceof Error?e.message:String(e));return json({error:'request_failed',paymentSettled:false},502)}
  }

  if (req.method !== "GET" || suffix !== "/v1/npm-risk") return json({ error: "not_found" }, 404);

  const requestedPackage = validatePackageName(internalUrl.searchParams.get("package"));
  if (!requestedPackage) return json({ error: "invalid_package", message: "Provide ?package=<npm-package>" }, 400);

  const publicResourceUrl = `${PUBLIC_BASE}/v1/npm-risk${internalUrl.search}`;
  let ctx;
  try { ctx = await paymentContext(publicResourceUrl); }
  catch (error) {
    console.error("NPM_RISK_PAYMENT_CONTEXT_FAILED", error instanceof Error ? error.message : String(error));
    return json({ error: "payment_configuration_unavailable" }, 503);
  }

  const paymentHeader = req.headers.get("PAYMENT-SIGNATURE") || req.headers.get("X-PAYMENT");
  if (!paymentHeader) {
    return json({
      error: "payment_required",
      accepts: [
        { network: NANO_NETWORK, price: `${NANO_PRICE} XNO` },
        { network: BASE_NETWORK, price: "$0.01 USDC" },
      ],
    }, 402, { "PAYMENT-REQUIRED": encodeWire(ctx.required) });
  }

  const payload = decodeWire(paymentHeader);
  if (!payload) return json({ error: "invalid_payment_payload" }, 400, { "PAYMENT-REQUIRED": encodeWire(ctx.required) });

  const network = selectedNetwork(payload);
  const paymentServer = network === BASE_NETWORK ? baseServer : network === NANO_NETWORK ? nanoServer : null;
  const requirements = network === BASE_NETWORK ? ctx.baseRequirements : network === NANO_NETWORK ? ctx.nanoRequirements : null;
  if (!paymentServer || !requirements) {
    return json({ error: "unsupported_payment_network", supported: [NANO_NETWORK, BASE_NETWORK] }, 402, {
      "PAYMENT-REQUIRED": encodeWire(ctx.required),
    });
  }

  try {
    const verified = await paymentServer.verifyPayment(payload, requirements);
    if (!verified.isValid) return json({ error: "invalid_payment", reason: verified.invalidReason }, 402, {
      "PAYMENT-REQUIRED": encodeWire(ctx.required),
    });

    let report;
    try { report = await buildNpmRiskReport(requestedPackage); }
    catch (error) {
      const status = statusCode(error, 502);
      return json({
        error: status === 404 ? "package_not_found" : status === 400 ? "invalid_package" : "upstream_error",
        message: error instanceof Error ? error.message : String(error),
      }, status);
    }

    const settled = await paymentServer.settlePayment(payload, requirements);
    if (!settled.success) return json({ error: "settlement_failed", reason: settled.errorReason }, 402, {
      "PAYMENT-REQUIRED": encodeWire(ctx.required),
    });

    console.log("NPM_RISK_X402_SETTLED", JSON.stringify({
      network, transaction: settled.transaction ?? null, package: requestedPackage, at: new Date().toISOString(),
    }));

    return json({ ...report, payment: settled.transaction ?? null, paymentNetwork: network }, 200, {
      "PAYMENT-RESPONSE": encodeWire(settled),
    });
  } catch (error) {
    console.error("NPM_RISK_REQUEST_FAILED", error instanceof Error ? error.message : String(error));
    return json({ error: "request_failed", message: error instanceof Error ? error.message : String(error) }, 400);
  }
});
