// 🎛 YARR 웹 스튜디오 (2026-11-03) · 듣기 사이트의 '스튜디오' 탭
//   만들기(연주곡 · 보컬곡 · AI 작사 · 목소리 36종 · 공간 24곳 · 프로 컨트롤 · 직접 찍기 시퀀서) → 테이크 듣고 고르기 → 올리기
//   곡 올리기 · 내 곡은 studio-upload.js
//   서버 규칙은 앱과 같아요 (house-music /make · /make-status · /make-more · /make-pick · /lyrics)
import {
  STATIONS, ST, GENRES, GENRE, LEADS, FLOWS, WEATHERS, TIMES, DURATIONS, KNOBS, VOICE_CATS, VOICES, QUICK_VOICES, QUIET_VOICES, LOUD_GENRES,
  ADLIBS, NARR_POS, NARR_TONE, NARR_VOICE, NARR_HINT, LYRIC_HINT, errText, newRecipe, bpmOf, genreName, defaultTitle,
  lines, lyricLang, lyricsProblem, narrProblem, lineWarn, normLyrics, splitLyrics, quotaOf, makeLabel, diffDraft, applyRequest, voiceLabel, VOICE_TUNE_ROWS,
  STATION_GROUPS, stGroupOf, voicePicks, THEMES, THEME, OPENINGS, LY_PENS, LY_HEATS, LY_TALKS, LY_VIEWS, lyricStyleRequest, lyricRequest, sectionRequest, sectionStyleRequest, dailyPick } from './studio-data.js?v=20261131';
import { ComposeDraft, ChordSlot, composeBars, composeRes } from './seq-core.js?v=20261113';
import { mountSequencer } from './seq-ui.js?v=20261115';
import { mountUpload, mountMine, ICONS } from './studio-upload.js?v=20261129';

const V = '20261131';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } } };
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const chips = (list, sel, attr, extra = '') => list.map(([id, label]) => `<button class="chip-b${id === sel ? ' on' : ''}" ${attr}="${esc(id)}" ${extra}>${esc(label)}</button>`).join('');

let B, sb, root, user = null, q = null;
const S = {
  view: 'make', vocal: false, recipe: newRecipe(), title: '', story: '', photo: null, ly: { v: '', c: '', b: '' }, bridgeOn: false, aiDraft: null,
  aiLang: 'ko', aiForm: 'basic', parent: null, recipePublic: false, notRegistered: false, byTheme: true, aiPen: 'auto', aiHeat: 'auto', aiTalk: 'auto', aiView: 'auto', aiHook: false, aiEng: 'none', consent: false, tone: 'f_clear', voiceCat: 'f', adlib: [], tune: {}, narr: { pos: 'none', tone: 'deep', voice: 'auto', text: '' },
  pro: false, moreGenres: false, composeOn: false, draft: null, busy: false, aiBusy: false, err: '',
  batch: null, status: null, sel: null, range: [0, 150], donate: false, done: null, polls: 0, timer: 0, startedAt: 0, checking: false,
};
let seq = null, takeAudio = null, playingTake = null;

// ---------- 서버 ----------
async function call(path, body, ms = 40000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(`${B.SB_URL}/functions/v1/house-music/${path}`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', apikey: B.SB_KEY, authorization: `Bearer ${session?.access_token || B.SB_KEY}` },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      if (r.status === 404 && !j) throw new Error('서버 함수(house-music)가 아직 배포되지 않았어요');
      throw Object.assign(new Error(errText(j?.error)), { code: j?.error, status: r.status });
    }
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('서버 응답이 늦어요. 잠시 뒤 다시 시도해 주세요.');
    if (e instanceof TypeError) throw new Error('서버에 연결되어 있지 않아요');
    throw e;
  } finally { clearTimeout(t); }
}
async function loadQuota() {
  const r = await sb.rpc('studio_quota').then((x) => x.data?.[0] || null, () => null);
  q = quotaOf(r); header();
}

// ---------- 시작 ----------
// 슬라이더 채움 비율 (CSS --p) · 다시 그려도 · 움직여도 맞춰요
function fillRange(i) { const lo = +i.min || 0, hi = +i.max || 100; i.style.setProperty('--p', `${hi > lo ? ((+i.value - lo) / (hi - lo)) * 100 : 0}%`); }
function watchRanges(el) {
  const all = () => el.querySelectorAll('.st-range input[type=range]').forEach(fillRange);
  el.addEventListener('input', (e) => { if (e.target.matches?.('.st-range input[type=range]')) fillRange(e.target); }, true);
  new MutationObserver(all).observe(el, { childList: true, subtree: true }); all();
}

export async function mount(el, bridge) {
  B = bridge; root = el;
  watchRanges(el);
  if (!document.getElementById('studioCss')) {
    const l = document.createElement('link'); l.id = 'studioCss'; l.rel = 'stylesheet'; l.href = new URL(`./studio.css?v=${V}`, import.meta.url).href; document.head.appendChild(l);
  }
  root.innerHTML = '<div class="login glass"><p class="soft" style="margin:0">스튜디오를 여는 중…</p></div>';
  sb = await B.loadSb();
  sb.auth.onAuthStateChange((_e, s) => { const u = s?.user && !s.user.is_anonymous ? s.user : null; if ((u?.id || null) !== (user?.id || null)) { user = u; boot(); } });
  const { data: { session } } = await sb.auth.getSession();
  user = session?.user && !session.user.is_anonymous ? session.user : null;
  await boot();
}
export function show() { if (user && S.batch && !S.timer) check(); }

/** 차트의 ⚡ 변주 (2026-11-05 · 068 SQL track_recipe): 레시피를 공개한 곡의 세팅만 빌려 와요
 *  가사 · 프롬프트 원문은 안 와요 · 올리면 '원곡: ○○' 으로 이어지고 원작자 몫이 정산돼요 */
export async function fork(id) {
  if (!sb) return;
  const { data, error } = await sb.rpc('track_recipe', { p_track: id });
  const t = Array.isArray(data) ? data[0] : null;
  if (error || !t) return B.toast('이 곡은 레시피가 공개되지 않았어요');
  stopPoll(); stopTake();
  const station = ST[t.station] ? t.station : '#WOOD_CAFE';
  const rc = t.recipe && typeof t.recipe === 'object' ? t.recipe : {};
  S.recipe = { ...newRecipe(station), ...rc, station };
  if (!t.recipe) S.recipe.genre = 'auto';
  S.vocal = t.instrumental === false;
  if (t.voice && VOICES.some((v) => v[0] === t.voice)) { S.tone = t.voice; S.voiceCat = VOICES.find((v) => v[0] === t.voice)[1]; }
  S.adlib = String(t.adlib || '').split(',').filter(Boolean);
  S.ly = { v: '', c: '', b: '' }; S.bridgeOn = false; S.aiDraft = null; S.consent = false; S.tune = {}; // 가사는 내 걸로
  S.draft = t.compose ? draftOf(t.compose) : null; S.composeOn = !!S.draft; if (S.draft) S.pro = true;
  S.parent = { id, title: t.title || '' };
  S.title = `${t.title || ''} (내 버전)`.slice(0, 60);
  Object.assign(S, { view: 'make', batch: null, status: null, sel: null, done: null, err: '' });
  if (user) { layout(); loadQuota(); renderMake(); }
  B.toast(`'${t.title}' 세팅을 불러왔어요 · 가사는 직접 써 주세요`);
}
// 🌐 내 곡을 다른 언어로 (2026-11-05): 줄별 음절을 맞춘 개사 가사 + 원곡 레시피 · 목소리 → 만들기 화면 (가사는 고칠 수 있어요)
export const LANG_FLAG = { ko: '🇰🇷', en: '🇺🇸', ja: '🇯🇵' };
export const LANG_NAME = { ko: '한국어', en: '영어', ja: '일본어' };
export async function translate(id, lang) {
  if (!sb || !user) return;
  B.toast(`${LANG_FLAG[lang] || '🌐'} ${LANG_NAME[lang] || ''} 가사로 개사하는 중… (20초쯤)`);
  let j;
  try { j = await call('lyrics', { mode: 'translate', track: id, lang }, 70000); } catch (x) {
    return B.toast(x.message);
  }
  stopPoll(); stopTake();
  const station = ST[j.station] ? j.station : '#WOOD_CAFE';
  const rc = j.recipe && typeof j.recipe === 'object' ? j.recipe : {};
  S.recipe = { ...newRecipe(station), ...rc, station };
  if (!j.recipe) S.recipe.genre = 'auto';
  S.vocal = true;
  if (j.vocal && VOICES.some((v) => v[0] === j.vocal)) { S.tone = j.vocal; S.voiceCat = VOICES.find((v) => v[0] === j.vocal)[1]; }
  S.adlib = String(j.adlib || '').split(',').filter(Boolean);
  S.ly = { v: (j.verse || []).join('\n'), c: (j.chorus || []).join('\n'), b: (j.bridge || []).join('\n') };
  S.bridgeOn = (j.bridge || []).length > 0;
  S.aiDraft = normLyrics(S.ly.v, S.ly.c, S.bridgeOn ? S.ly.b : ''); S.aiLang = lang;
  S.consent = false; S.tune = {}; S.narr = { ...(S.narr || {}), pos: 'none' };
  S.draft = j.compose ? draftOf(j.compose) : null; S.composeOn = !!S.draft; if (S.draft) S.pro = true;
  S.parent = { id, title: j.parent?.title || '', lang, from: j.from };
  S.title = String(j.title || `${j.parent?.title || ''} (${LANG_NAME[lang]})`).slice(0, 60);
  Object.assign(S, { view: 'make', batch: null, status: null, sel: null, done: null, err: '' });
  layout(); loadQuota(); renderMake();
  B.toast('개사 가사가 왔어요 · 확인하고 고친 뒤 [필수] 동의에 체크해 주세요');
}
/** 서버에 저장된 멜로디(검사 뒤 모양) → 시퀀서 초안 */
function draftOf(c) {
  try {
    const pro = c.pro && typeof c.pro === 'object' ? c.pro : null;
    // 앱 · 웹이 v3(틱 · res)로 보냈으면 서버가 pro.fine(틱) + pro.res 를 같이 저장해요 → 그대로 v3 로 읽어요 (fromJson 이 res 를 지금 틱으로 바꿔요)
    //   fine 이 없으면 pro.tracks(박) = 예전 v2
    const fine = pro && pro.fine && typeof pro.fine === 'object' && !Array.isArray(pro.fine);
    const res = fine && Number.isInteger(pro.res) && pro.res >= 1 && pro.res <= composeRes && composeRes % pro.res === 0 ? pro.res : 0;
    const j = { key: c.key, chords: c.chords, notes: c.notes, drums: c.drums, parts: c.parts,
      ...(pro ? { pro: { ...(res ? { v: 3, res, tracks: pro.fine } : { v: 2, tracks: pro.tracks }), drum: pro.drum, lead: pro.lead, mix: pro.mix, fx: { swing: pro.swing ?? 0 } } } : {}) };
    const d = ComposeDraft.fromJson(j);
    if (d && pro && Array.isArray(c.chords) && c.chords.length === composeBars) d.slots = c.chords.map((x) => ChordSlot.parse(String(x)));
    return d;
  } catch { return null; }
}

async function boot() {
  if (!user) return gate();
  if (!ls.get('yarr_web_age_ok', false)) ls.set('yarr_web_age_ok', true); // 로그인 화면에서 동의를 받았어요
  if (!S.parent) { // 변주로 들어왔으면 빌려 온 세팅 그대로
    S.recipe.station = ls.get('yarr_web_studio_station', '#WOOD_CAFE');
    if (!ST[S.recipe.station]) S.recipe.station = '#WOOD_CAFE';
    S.title = defaultTitle(S.recipe.station);
  }
  layout();
  await loadQuota();
  S.batch = S.parent ? null : ls.get('studio_batch', null);
  if (S.batch) check(); else renderMake();
}

// ---------- 로그인 (진짜 계정 · 만 14세 · 약관) ----------
function gate() {
  stopPoll();
  root.innerHTML = `<div class="studio"><div class="login glass" style="max-width:520px">
    <span class="chip o">✨ YARR 스튜디오</span>
    <h1 style="margin-top:10px">웹에서 바로 내 곡 만들기</h1>
    <p class="soft" style="margin:0 0 14px">AI 작사 · 목소리 36종 · 공간 24곳 · 직접 찍는 시퀀서로 곡을 만들고, 만든 곡이나 다른 곳에서 만든 곡을 올려 차트에 도전해요. 만든 기록을 지키려면 로그인이 필요해요.</p>
    <label class="st-check"><input type="checkbox" id="gAge"> <span>만 14세 이상이에요</span></label>
    <label class="st-check"><input type="checkbox" id="gTerms"> <span>이용약관과 개인정보 처리방침에 동의해요 · <a href="/terms.html" target="_blank" style="color:#FB923C">이용약관</a> · <a href="/privacy.html" target="_blank" style="color:#FB923C">개인정보 처리방침</a></span></label>
    <p class="st-note" style="margin:0 0 14px">만 14세 미만은 보호자 동의 기능이 생길 때까지 YARR 를 이용할 수 없어요.</p>
    <div id="gBox" class="dim-box">
      <div class="row hidden" id="gOauth"><button class="btn kakao hidden" data-o="kakao">카카오로 계속하기</button><button class="btn google hidden" data-o="google">구글로 계속하기</button></div>
      <div class="or hidden" id="gOr">또는 이메일 코드</div>
      <div class="row" id="gEmailStep"><input type="email" id="gEmail" placeholder="이메일" autocomplete="email"><button class="btn" id="gSend">코드 받기</button></div>
      <div class="row hidden" id="gCodeStep"><input type="text" id="gCode" inputmode="numeric" autocomplete="one-time-code" placeholder="메일로 받은 6자리 코드"><button class="btn" id="gVerify">확인</button></div>
    </div>
    <p class="msg" id="gMsg"></p>
    <p class="st-note">앱을 쓰고 있다면 앱에 연결한 이메일 · 카카오 · 구글로 로그인하면 만든 곡과 남은 횟수가 그대로 이어져요.</p>
  </div></div>`;
  const $ = (id) => root.querySelector('#' + id);
  const msg = (t, bad) => { $('gMsg').textContent = t || ''; $('gMsg').classList.toggle('bad', !!bad); };
  const okToGo = () => { const ok = $('gAge').checked && $('gTerms').checked; $('gBox').style.opacity = ok ? 1 : 0.45; $('gBox').style.pointerEvents = ok ? '' : 'none'; return ok; };
  $('gAge').onchange = okToGo; $('gTerms').onchange = okToGo; okToGo();
  fetch(`${B.SB_URL}/auth/v1/settings`, { headers: { apikey: B.SB_KEY } }).then((r) => r.json()).then((j) => {
    let any = false;
    root.querySelectorAll('[data-o]').forEach((b) => { const on = j?.external?.[b.dataset.o] === true; b.classList.toggle('hidden', !on); any = any || on; });
    $('gOauth').classList.toggle('hidden', !any); $('gOr').classList.toggle('hidden', !any);
  }).catch(() => {});
  root.querySelectorAll('[data-o]').forEach((b) => b.onclick = async () => {
    if (!okToGo()) return;
    msg('로그인 창으로 이동해요…'); B.rememberLogin(); ls.set('yarr_web_age_ok', true);
    const { data, error } = await sb.auth.signInWithOAuth({ provider: b.dataset.o, options: { redirectTo: `${B.base()}?tab=studio`, skipBrowserRedirect: true } });
    if (error || !data?.url) return msg('로그인 창을 열지 못했어요. 이메일 코드로 로그인해 주세요.', true);
    location.href = data.url;
  });
  $('gSend').onclick = async () => {
    if (!okToGo()) return;
    const email = $('gEmail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return msg('이메일 주소를 확인해 주세요.', true);
    $('gSend').disabled = true; msg('코드를 보내는 중…');
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    $('gSend').disabled = false;
    if (error) return msg(/rate|seconds/i.test(error.message) ? '잠시 후 다시 시도해 주세요.' : '코드를 보내지 못했어요. 잠시 후 다시 시도해 주세요.', true);
    $('gEmailStep').classList.add('hidden'); $('gCodeStep').classList.remove('hidden'); $('gCode').focus(); msg('메일로 보낸 6자리 코드를 입력해 주세요.');
  };
  $('gVerify').onclick = async () => {
    const { error } = await sb.auth.verifyOtp({ email: $('gEmail').value.trim(), token: $('gCode').value.trim(), type: 'email' });
    if (error) return msg('코드가 맞지 않거나 시간이 지났어요. 다시 받아 주세요.', true);
    ls.set('yarr_web_age_ok', true);
  };
  $('gCode').onkeydown = (e) => { if (e.key === 'Enter') $('gVerify').click(); };
  $('gEmail').onkeydown = (e) => { if (e.key === 'Enter') $('gSend').click(); };
}

// ---------- 틀 ----------
function layout() {
  root.innerHTML = `<div class="studio">
    <div class="st-top">
      <div><span class="chip o">✨ YARR 스튜디오</span><h1 style="margin-top:8px" id="stH">야르에서 바로 만들기</h1><p class="lead" id="stSub" style="margin:0"></p><p class="st-note" id="stTrial" style="margin:4px 0 0"></p></div>
      <div style="display:flex;gap:8px;align-items:center"><span class="st-count" title="오늘 남은 만들기" id="stLed">MAKE --</span><button class="btn sub" id="stOut" style="padding:8px 12px;font-size:12.5px">로그아웃</button></div>
    </div>
    <div class="st-tabs" id="stTabs"><button data-v="make" class="on">${ICONS.make}곡 만들기</button><button data-v="upload">${ICONS.upload}곡 올리기</button><button data-v="mine">${ICONS.mine}내 곡</button></div>
    <div id="stBody"></div>
    <p class="st-err st-note" id="stErr"></p>
  </div>`;
  root.querySelector('#stOut').onclick = async () => { stopPoll(); await sb.auth.signOut(); };
  root.querySelector('#stTabs').onclick = (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    S.view = b.dataset.v; root.querySelectorAll('#stTabs button').forEach((x) => x.classList.toggle('on', x === b));
    stopTake(); seq?.stop();
    if (S.view === 'make') { S.batch ? renderResult() : renderMake(); }
    else if (S.view === 'upload') mountUpload(body(), { sb, user, B, err, call, onDone: loadQuota });
    else mountMine(body(), { sb, user, B, onTranslate: translate, onGo: (v) => root.querySelector(`#stTabs [data-v="${v}"]`)?.click() });
  };
  header();
}
const body = () => root.querySelector('#stBody');
function header() {
  const led = root?.querySelector('#stLed'); if (!led) return;
  led.textContent = `MAKE ${q ? q.led : '--'}`;
  const vocal = S.status?.vocal ?? S.vocal;
  root.querySelector('#stSub').textContent = vocal ? '내 가사로 노래를 만들어요 · 보컬곡' : '어디서 틀지 고르면 야르가 레시피를 맞춰요 · 연주곡';
  root.querySelector('#stTrial').textContent = q?.trialLine || '';
}
function err(t) { S.err = t || ''; const e = root.querySelector('#stErr'); if (e) e.textContent = S.err; if (t) B.toast(t); }

// ---------- 만들기 화면 ----------
const aiExact = () => S.aiDraft != null && normLyrics(S.ly.v, S.ly.c, S.bridgeOn ? S.ly.b : '') === S.aiDraft && S.narr.pos === 'none';
/** 🎲 오늘의 레시피 카드 (2026-11-10): 매일 하나 · 누르면 만들기 화면에 채워요 (만들기는 사용자가 눌러요) */
function dailyCard() {
  const x = dailyPick(), on = S.dailyOn === x.key && S.recipe.station === x.station && S.recipe.genre === x.genre;
  const bits = [GENRE[x.genre], ST[x.station]?.tag, x.vocal ? '보컬곡' : '연주곡', ...(x.spark ? ['✨ 실험적으로'] : [])].filter(Boolean);
  // 오늘 몇 명이 만들었는지 (088 SQL · 숫자만) · 한 번만 불러와요
  if (sb && S.dailyN?.key !== x.key && !S.dailyAsk) {
    S.dailyAsk = true;
    sb.rpc('daily_recipe_count', { p_key: x.key }).then((r) => { S.dailyAsk = false; if (typeof r.data === 'number') { S.dailyN = { key: x.key, n: r.data }; renderMake(); } }, () => { S.dailyAsk = false; });
  }
  const n = S.dailyN?.key === x.key ? S.dailyN.n : null;
  const who = n == null ? '' : n > 0 ? `<span class="dl-n">🔥 오늘 ${n}명이 이 레시피로 만들었어요</span>` : '<span class="dl-n">오늘 첫 번째로 만들어 보세요</span>';
  return `<div class="st-daily${on ? ' on' : ''}"><div class="dl-l"><span class="dl-tag">🎲 오늘의 레시피 · ${x.date}</span><b>${x.emoji} ${esc(x.title)}</b><small>${bits.map(esc).join(' · ')}</small>${who}</div>
    <button class="btn${on ? ' sub' : ''}" data-daily="1">${on ? '✓ 채웠어요' : '이 레시피로 만들기'}</button></div>`;
}
const hasLines = () => lines(S.ly.v).length + lines(S.ly.c).length + (S.bridgeOn ? lines(S.ly.b).length : 0) > 0;

function renderMake() {
  if (S.view !== 'make') return;
  seq?.destroy(); seq = null;
  const r = S.recipe, vocal = S.vocal, st = ST[r.station];
  // 공간 24곳: 묶음 칩 → 그 묶음의 공간 칩 (앱 StationPicker 와 같아요 · 2026-11-08)
  const selG = stGroupOf(r.station), g = S.stGroup ?? selG;
  body().innerHTML = `${S.parent ? (S.parent.lang
    ? `<div class="st-fork">🌐 <b>'${esc(S.parent.title)}'</b>의 ${LANG_FLAG[S.parent.lang]} ${LANG_NAME[S.parent.lang]} 버전 · 원곡 레시피 · 목소리 그대로, 가사는 줄마다 음절을 맞춰 개사했어요 (고쳐도 돼요) · 올리면 차트에서 원곡 아래 <b>같은 분위기의 다국어 버전</b>으로 묶여요<button class="seq-key" id="mUnfork">✕ 해제</button></div>`
    : `<div class="st-fork">🔗 <b>'${esc(S.parent.title)}'</b> 세팅을 빌려왔어요 · 가사는 직접 써요 · 올리면 <b>원곡: ${esc(S.parent.title)}</b> 표시가 붙어요<button class="seq-key" id="mUnfork">✕ 해제</button></div>`) : ''}${!S.parent && (S.ly.v.trim() || S.ly.c.trim() || S.story.trim()) ? `<div class="st-fork">✍️ ${S.carried ? '이전 곡 가사를 이어서 쓰고 있어요' : '지난번 주제 · 가사가 채워져 있어요'}<button class="seq-key" id="mFresh">↺ 새로 시작</button></div>` : ''}<div class="st-grid">
    <div>
      ${dailyCard()}
      <div class="st-card">
        <div class="st-tabs" style="margin-bottom:6px"><button data-vocal="0" class="${vocal ? '' : 'on'}">🎹 연주곡 · 매장 · 차트</button><button data-vocal="1" class="${vocal ? 'on' : ''}">🎤 보컬곡 · 내 가사로</button></div>
        <div class="st-q">1 · ${vocal ? (S.byTheme ? '어떤 이야기 · 감정의 노래인가요?' : '어떤 분위기의 곡인가요?') : '어디서 틀 곡인가요?'}</div>
        ${vocal ? `<div class="chips" style="margin-bottom:8px"><button class="chip-b${S.byTheme ? ' on' : ''}" data-bytheme="1">💬 주제 · 감정으로</button><button class="chip-b${S.byTheme ? '' : ' on'}" data-bytheme="0">📍 장소 분위기로</button></div>` : ''}
        ${vocal && S.byTheme ? `<div class="chips">${THEMES.map(([k, n]) => `<button class="chip-b${r.theme === k ? ' on' : ''}" data-theme="${k}">${esc(n)}</button>`).join('')}</div>` : `<div class="chips st-groups">${STATION_GROUPS.map(([name], i) => `<button class="chip-b grp${i === g ? ' on' : ''}" data-stg="${i}">${esc(name)}${i === selG && i !== g ? ' •' : ''}</button>`).join('')}</div>
        <div class="chips" style="margin-top:8px">${STATION_GROUPS[g][1].map((c) => ST[c]).filter(Boolean).map((s) => `<button class="chip-b${s.code === r.station ? ' on' : ''}" data-st="${s.code}">${esc(s.tag)}</button>`).join('')}</div>`}
        ${vocal ? vocalSimple() : ''}
      </div>
      <button class="st-fold${S.pro ? ' open' : ''}" id="mPro"><div><b>🎛 프로 하드웨어 컨트롤</b><br><span>${vocal ? `장르 · 목소리 ${VOICES.length}종 · 노브 · 가사 직접 쓰기 · 멜로디 찍기 · 제목` : '장르 · 악기 · 노브 · 날씨 · 길이 · 멜로디 찍기 · 제목'}</span></div><span class="ic">⌄</span></button>
      <div id="mProBody" class="${S.pro ? '' : 'hidden'}">${proPanel()}</div>
    </div>
    <div>
      <div class="st-card">
        <div class="lcd" style="margin-bottom:14px"><div class="lcd-1">RECIPE · ${bpmOf(r)} BPM · ${esc(genreName(r))}${vocal ? ' · VOCAL' : ''}${S.composeOn && S.draft ? ' · MY MELODY ' + esc(S.draft.chords.join('-')) : ''}</div><div class="lcd-2">${esc(vocal ? voiceLabel(S.tone) : (st?.tag || ''))} · ${r.duration}초</div></div>
        ${fitCard()}
        ${!S.pro ? `<div class="st-q">곡 제목</div><input class="st-in" id="mTitle" maxlength="60" value="${esc(S.title)}">` : ''}
        ${vocal && hasLines() ? consentBox() : ''}
        <button class="btn st-go" id="mGo"></button>
        <p class="st-note" id="mFoot"></p>
      </div>
      <div id="mSeqWrap" class="${S.composeOn ? '' : 'hidden'}" style="margin-top:16px"><div id="mSeq"></div></div>
    </div>
  </div>`;
  bindMake();
  if (S.composeOn) mountSeq();
  goBtn(); header();
}

function vocalSimple() {
  const hint = LYRIC_HINT[S.recipe.station] || ['예: 골목 끝 작은 가게에 불이 켜지면', '예: 오늘 밤 우리의 노래는 멈추지 않아'];
  const quick = voicePicks(S.tone, S.recipe.genre); // 장르에 맞춘 추천 6개 (앱과 같아요 · 2026-11-08)
  return `
    <div class="st-q">2 · 어떤 이야기를 노래로 만들까요?<span class="r"><button class="seq-key" id="mAi">${S.aiDraft ? '✨ 다시 쓰기' : '✨ AI 작사'}</button></span></div>
    <textarea class="st-ta" id="mStory" maxlength="150" style="min-height:64px" placeholder="예: 새벽 세 시, 잠들지 못한 마음을 다독이는 노래">${esc(S.story)}</textarea>
    <div class="st-cnt"><span id="mStoryN">${S.story.length}</span>/150</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
      <label class="btn sub" style="padding:8px 12px;font-size:12.5px">📷 사진 첨부<input type="file" accept="image/*" id="mPhoto" hidden></label>
    </div>
    ${S.photo ? `<div style="display:flex;gap:10px;align-items:center;margin-top:10px"><img src="${S.photo.url}" style="width:56px;height:56px;object-fit:cover;border-radius:10px"><span class="st-note" style="margin:0;flex:1">이 사진의 분위기로 가사를 써요 · 사진은 저장하지 않아요</span><button class="seq-x" id="mPhotoX" title="사진 빼기">✕</button></div>` : ''}
    ${hasLines() ? `<div class="st-q">${aiExact() ? `✨ AI가 쓴 가사 · 제목 '${esc(S.title)}'` : '내 가사'}<span class="r"><button class="seq-key" id="mEditLy">고치기</button></span></div>
      <div class="lyr">${esc(['[절]', S.ly.v, '', '[후렴]', S.ly.c, ...(S.bridgeOn && S.ly.b ? ['', '[브릿지]', S.ly.b] : [])].join('\n'))}</div>` : `<p class="st-note">이야기 한 줄만 적어도 AI가 가사와 제목을 써요. 직접 쓰려면 아래 프로 컨트롤의 '내 가사 쓰기'를 열어요.</p>`}
    <div class="st-q">목소리</div>
    <div class="chips">${quick.map((id) => `<button class="chip-b${id === S.tone ? ' on' : ''}" data-tone="${id}">${esc(voiceLabel(id))}</button>`).join('')}<button class="chip-b" id="mAllVoices">+ 목소리 ${VOICES.length}종 전체 ▾</button></div>
    ${QUIET_VOICES.includes(S.tone) && LOUD_GENRES.includes(S.recipe.genre) ? '<p class="st-warn" style="margin-top:10px">⚠ 이 장르는 반주가 세서 조용한 목소리가 묻히거나 다른 목소리가 섞일 수 있어요. 어쿠스틱 · 인디 · 포크 · 보사노바 · 재즈에서 가장 잘 살아요.</p>' : ''}`;
}

function proPanel() {
  const r = S.recipe, vocal = S.vocal;
  const shown = S.moreGenres ? GENRES : GENRES.filter((g, i) => i < 16 || g[0] === r.genre);
  const pr = lyricsProblem(S.ly.v, S.ly.c, S.bridgeOn ? S.ly.b : '');
  const blockStat = (t) => { const L = lines(t); if (!L.length) return '비어 있어요'; if (L.length > 8) return `${L.length}줄 · 8줄까지`; const long = L.filter((l) => l.replace(/\s/g, '').length > lineWarn(t)).length; return long ? `${L.length}줄 · 긴 줄 ${long}개` : `${L.length}줄 · 좋아요`; };
  const hint = LYRIC_HINT[r.station] || ['예: 골목 끝 작은 가게에 불이 켜지면', '예: 오늘 밤 우리의 노래는 멈추지 않아'];
  return `<div class="st-card" style="margin-top:12px">
    <div class="st-q">02 · 장르</div>
    <div class="chips">${chips(shown, r.genre, 'data-genre')}<button class="chip-b" id="mMoreG">${S.moreGenres ? '접기 ▴' : `+ 장르 ${GENRES.length - 16}개 더 보기 ▾`}</button></div>
    ${vocal ? `<div class="st-q">보컬 톤</div><div class="chips">${chips(VOICE_CATS, S.voiceCat, 'data-vcat')}</div>
      <div class="chips" style="margin-top:8px">${VOICES.filter((v) => v.cat === S.voiceCat).map((v) => `<button class="chip-b${v.id === S.tone ? ' on' : ''}" data-tone="${v.id}">${esc(v.label)}</button>`).join('')}</div>
      <p class="st-note">${esc(VOICES.find((v) => v.id === S.tone)?.desc || '예전에 쓰던 목소리예요. 이 곡은 그대로 이어서 만들 수 있어요.')} · 같은 버튼이어도 곡마다 조금씩 다르게 불러요.</p>
      <div class="st-q">목소리 다듬기 <span class="r">가운데는 자동 · 고른 칸만 반영돼요</span></div>
      ${VOICE_TUNE_ROWS.map(([k, label, lo, hi]) => `<div class="tune-row"><span class="tune-l">${label}</span><div class="chips">${[[-1, lo], [0, '자동'], [1, hi]].map(([v, t]) => `<button class="chip-b${(S.tune[k] || 0) === v ? ' on' : ''}" data-tune="${k}:${v}">${esc(t)}</button>`).join('')}</div></div>`).join('')}
      ${S.tune.texture === -1 && ['f_jazz', 'm_rock', 'm_ballad'].includes(S.tone) ? '<p class="st-warn" style="margin-top:6px">허스키한 목소리에 \'맑게\'를 고르면 서로 부딪혀요. 원하는 쪽 하나만 고르면 더 또렷하게 나와요.</p>' : ''}
      ${['duet', 'indie_duo'].includes(S.tone) ? '<p class="st-note">절은 남자, 후렴 앞부분은 여자가 부르고 끝은 둘이 함께 부르도록 야르가 파트를 나눠요.</p>' : S.tone === 'choir' ? '<p class="st-note">첫 소절부터 여럿이 함께 부르는 합창으로 만들어요.</p>' : ['group_girl', 'group_boy'].includes(S.tone) ? '<p class="st-note">절은 멤버들이 주고받고, 후렴은 다 함께 부르도록 야르가 파트를 나눠요.</p>' : ''}`
    : `<div class="st-q">주인공 악기</div><div class="chips">${chips(LEADS, r.lead, 'data-lead')}</div>`}
    <div class="st-q">곡 흐름</div><div class="chips">${chips(FLOWS, r.flow, 'data-flow')}</div>
    <div class="chips" style="margin-top:10px;align-items:center"><button class="chip-b${r.spark ? ' on' : ''}" data-spark="1">✨ 실험적으로</button><span class="st-note" style="margin:0 0 0 6px">다른 장르를 하나 섞고 뜻밖의 악기를 넣어요. 더 독특하지만 낯설 수 있어요.</span></div>
    <div class="st-q">03 · 분위기 노브 <span class="r">차가움 ↔ 따뜻함 · 한가함 ↔ 바쁨(BPM) · 깔끔함 ↔ 빈티지</span></div>
    ${KNOBS.map(([k, label, lo, hi]) => `<div class="st-range"><span style="width:58px;font-size:12.5px;font-weight:700">${label}</span><span class="st-note" style="margin:0;width:44px">${lo}</span><input type="range" min="0" max="4" step="1" value="${r[k]}" data-knob="${k}"><span class="st-note" style="margin:0;width:44px;text-align:right">${hi}</span></div>`).join('')}
    <p class="st-note">템포 <b id="mBpm">${bpmOf(r)} BPM</b> · 바쁨 노브로 바뀌어요</p>
    <div class="st-q">04 · 날씨 · 시간</div><div class="chips">${chips(WEATHERS, r.weather, 'data-weather')}</div><div class="chips" style="margin-top:6px">${chips(TIMES, r.time, 'data-time')}</div>
    <div class="st-q">05 · 길이</div><div class="chips">${chips(DURATIONS.map((d) => [String(d), `${d}초`]), String(r.duration), 'data-dur')}</div>
    ${vocal ? `<div class="st-q">곡 시작</div><div class="chips">${chips(OPENINGS, r.opening || 'auto', 'data-opening')}</div>` : ''}
    <div class="st-q">🎹 멜로디 직접 찍기 (선택)<span class="r"><label class="sw" style="display:inline-block;vertical-align:middle"><input type="checkbox" id="mCompose" ${S.composeOn ? 'checked' : ''}><i></i></label></span></div>
    <p class="st-note" style="margin-top:0">도트로 음표 · 코드 · 드럼을 찍으면 그 멜로디대로 연주 · 노래해요. 켜면 오른쪽(폰은 아래)에 스텝 시퀀서가 열려요.</p>
    ${vocal ? `
    <div class="st-q">06 · 내 가사 쓰기</div>
    <p class="st-note" style="margin-top:0">한 줄에 15자 안팎으로 짧게 끊어 쓸수록 발음이 또렷해요 · 절 4줄 + 후렴 4줄 추천</p>
    <div class="st-q" style="margin-top:10px">절 (Verse) · 도입부<span class="r" id="mStV">${blockStat(S.ly.v)}</span></div><textarea class="st-ta" data-ly="v" maxlength="400" placeholder="${esc('예: ' + hint[0].replace(/^예: /, ''))}">${esc(S.ly.v)}</textarea>
    <div class="st-q">후렴 (Chorus) · 하이라이트<span class="r" id="mStC">${blockStat(S.ly.c)}</span></div><textarea class="st-ta" data-ly="c" maxlength="400" placeholder="${esc('예: ' + hint[1].replace(/^예: /, ''))}">${esc(S.ly.c)}</textarea>
    ${S.bridgeOn ? `<div class="st-q">브릿지 (Bridge) · 분위기 전환<span class="r"><button class="seq-key" id="mAiBridge">브릿지만 AI로 쓰기</button></span></div><textarea class="st-ta" data-ly="b" maxlength="400" placeholder="예: 잠시 멈춰 서서 하늘을 봐">${esc(S.ly.b)}</textarea>` : ''}
    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn sub" id="mBridge" style="padding:8px 12px;font-size:12.5px">${S.bridgeOn ? '브릿지 빼기' : '브릿지 추가'}</button>${chips(ADLIBS, null, 'data-adlib')}</div>
    <p class="st-note" id="mLyStat">전체 ${lines(S.ly.v).length + lines(S.ly.c).length + (S.bridgeOn ? lines(S.ly.b).length : 0)}줄 · 4~20줄까지 · 150초 이상이면 후렴을 한 번 더 불러요${/[0-9&%~]/.test(S.ly.v + S.ly.c + S.ly.b) ? '<br>숫자 · 기호는 야르가 한글 발음으로 바꿔 불러요 (예: 12시 → 열두 시). 직접 한글로 쓰면 더 정확해요.' : ''}</p>
    ${S.aiDraft != null ? `<p class="st-note">${aiExact() ? '✨ AI가 쓴 가사예요 · 그대로 만들면 차트 · 리스너 · 매장에 나가요' : S.narr.pos !== 'none' && normLyrics(S.ly.v, S.ly.c, S.bridgeOn ? S.ly.b : '') === S.aiDraft ? '✏️ 첫마디(나레이션)를 직접 써서, 직접 쓴 가사로 보고 매장에서는 빠져요' : '✏️ AI 가사를 고쳤어요 · 직접 쓴 가사로 보고 차트 · 리스너용으로만 나가요 (매장 제외)'}</p>` : ''}
    ${hasLines() && pr ? `<p class="st-err st-note">${esc(errText(pr))}</p>` : ''}
    <div class="st-q">07 · 말하기 & 나레이션 (선택) <span class="chip-b" style="padding:2px 8px;font-size:11px">실험</span></div>
    <p class="st-note" style="margin-top:0">노래 시작 전이나 간주, 끝에 분위기 있는 목소리를 얹어요. 말할 문장은 직접 써 주세요 (1~2줄).</p>
    <div class="chips">${chips(NARR_POS, S.narr.pos, 'data-npos')}</div>
    ${S.narr.pos !== 'none' ? `<div class="st-q">나레이션 톤</div><div class="chips">${chips(NARR_TONE, S.narr.tone, 'data-ntone')}</div><div class="chips" style="margin-top:6px">${chips(NARR_VOICE, S.narr.voice, 'data-nvoice')}</div>
      <textarea class="st-ta" id="mNarr" maxlength="80" style="min-height:56px;margin-top:8px" placeholder="예: ${esc(NARR_HINT[r.station] || '오늘 밤도 따뜻하게 보내')}">${esc(S.narr.text)}</textarea>
      <p class="st-note">AI 목소리가 노래하지 않고 말하듯 읽어요. 실험 기능이라 가끔은 노래처럼 들릴 수 있어요.</p>${narrProblem(S.narr) && S.narr.text ? `<p class="st-err st-note">${esc(errText(narrProblem(S.narr)))}</p>` : ''}` : ''}` : ''}
    <div class="st-q">곡 제목</div><input class="st-in" id="mTitle" maxlength="60" value="${esc(S.title)}">
  </div>`;
}

function fitCard(keep) {
  const r = S.recipe, st = ST[r.station], bpm = S.status?.bpm ?? bpmOf(r), fits = Math.abs(bpm - st.bpm) <= 16, dur = keep ?? r.duration;
  const vocal = S.status?.vocal ?? S.vocal;
  const ok = (t) => `<div class="st-note" style="margin:4px 0">✓ ${t}</div>`;
  if (!vocal) {
    const slot = r.time !== 'none' ? Object.fromEntries(TIMES)[r.time] : st.slot || '언제나';
    return `<div class="st-q" style="margin-top:0">매장 적합도 체크</div>${ok('연주곡 · 매장 배경음악으로 나갈 수 있어요')}${fits ? ok(`템포 ${bpm} BPM · ${esc(st.tag)} 기본 템포에 맞아요`) : ''}${dur >= 60 ? ok(`길이 ${Math.round(dur)}초 · 60초 이상이라 재생이 집계돼요`) : ''}${ok(`추천 시간대: ${esc(slot)}`)}${ok('올리면 자동 검수가 음량을 매장 기준(-14 LUFS)에 맞추고 앞뒤를 부드럽게 해요')}`;
  }
  if (!hasLines() && !S.status) return '';
  const n = lines(S.ly.v).length + lines(S.ly.c).length + (S.bridgeOn ? lines(S.ly.b).length : 0);
  const all = [...lines(S.ly.v), ...lines(S.ly.c)], warn = lineWarn(all.join('\n'));
  return `<div class="st-q" style="margin-top:0">보컬곡 · 차트 도전 체크</div>${ok(aiExact() ? 'AI 작사 가사 · 차트 · 리스너 감상 · 매장에 나가요' : '직접 쓴 가사 · 차트 경쟁과 리스너 감상용으로 등록돼요 (매장 재생 제외)')}${fits ? ok(r.theme && r.theme !== 'none' && THEME[r.theme] ? `템포 ${bpm} BPM · ${esc(THEME[r.theme].name)} 노래에 맞아요` : `템포 ${bpm} BPM · ${esc(st.tag)} 분위기에 맞아요`) : ''}${!S.status && n >= 6 && n <= 16 ? ok(lines(S.ly.v).length === 4 && lines(S.ly.c).length === 4 ? `분량 ${n}줄 · 절 4줄 + 후렴 4줄 · 발음이 가장 또렷한 분량이에요` : `분량 ${n}줄 (절 ${lines(S.ly.v).length} · 후렴 ${lines(S.ly.c).length}) · 절 4줄 + 후렴 4줄이면 더 또렷해요`) : ''}${!S.status && all.length && all.every((l) => l.replace(/\s/g, '').length <= warn) ? ok(`한 줄 ${warn}자 이하 · 짧게 끊을수록 또렷해요`) : ''}${dur >= 60 ? ok(`길이 ${Math.round(dur)}초 · 60초 이상이라 재생이 집계돼요`) : ''}${ok('올리면 자동 검수가 음량을 맞추고 앞뒤를 부드럽게 해요')}`;
}
function consentBox() {
  return `<label class="st-check" style="margin-top:14px"><input type="checkbox" id="mConsent" ${S.consent ? 'checked' : ''}><span><b>${aiExact() ? '[필수] AI가 쓴 가사를 확인했고, 남의 노래 가사를 넣지 않았어요' : '[필수] 남의 가사를 베끼지 않고 직접 쓴 창작 가사예요'}</b><br><span class="st-note" style="margin:0">가수 · 곡 이름을 넣거나 기존 노래 가사를 옮기면 신고 · 검수에서 내려가고 업로드가 멈출 수 있어요. 동의한 시각이 곡과 함께 기록돼요.</span></span></label>`;
}

function goBtn() {
  const b = root.querySelector('#mGo'); if (!b) return;
  const needLyrics = S.vocal && !hasLines();
  const problem = S.vocal && hasLines() ? (lyricsProblem(S.ly.v, S.ly.c, S.bridgeOn ? S.ly.b : '') || narrProblem(S.narr)) : null;
  const lyricsOk = !S.vocal || (!problem && S.consent);
  b.textContent = makeLabel(q, { needLyrics, aiBusy: S.aiBusy });
  b.disabled = S.busy || S.aiBusy || !q?.canMake || !(lyricsOk || needLyrics);
  const foot = root.querySelector('#mFoot');
  if (foot) foot.innerHTML = esc(
    S.vocal && problem ? `만들기 전에 고쳐 주세요: ${errText(problem)}`
      : S.vocal && hasLines() && !S.consent ? '가사를 확인하고 위의 [필수] 동의에 체크하면 만들 수 있어요.'
        : S.vocal && !hasLines() ? '이야기 한 줄만 적어도 AI가 가사와 제목을 써요. 가사를 확인하고 동의하면 바로 만들어요.'
          : S.vocal ? (aiExact() ? 'AI가 쓴 가사 그대로 만들면 차트 · 리스너 · 매장에 모두 나가요.' : '직접 고친 가사는 차트 · 리스너용으로 나가요 (매장 재생 제외).')
            : '만든 곡은 내 곡으로 올라가 자동 검수 뒤 차트 · 스테이션 · 매장에 나가요. 프롬프트는 버튼으로만 조립돼요 (가수 이름 · 기존 곡 따라 하기 없음).',
  ) + '<br><span style="opacity:.75">시작하면 취소할 수 없어요 · 화면을 닫아도 계속 만들어져요</span>'; // 2026-11-08 · 취소 버튼은 두지 않아요
}

function bindMake() {
  const el = body();
  el.onclick = async (e) => {
    const t = e.target.closest('button'); if (!t || !el.contains(t)) return;
    const r = S.recipe, d = t.dataset;
    if (d.vocal !== undefined) { S.vocal = d.vocal === '1'; if (S.vocal) r.lead = 'auto'; err(''); return renderMake(); }
    if (d.stg !== undefined) { S.stGroup = +d.stg; return renderMake(); }
    if (d.bytheme !== undefined) { S.byTheme = d.bytheme === '1'; if (!S.byTheme) r.theme = 'none'; return renderMake(); }
    if (d.theme) { // 주제를 고르면 어울리는 공간(반주 기본)도 같이 · 다시 누르면 해제 (앱과 같아요)
      if (r.theme === d.theme) { r.theme = 'none'; return renderMake(); }
      const th = THEME[d.theme], wasDef = S.title === defaultTitle(r.station);
      if (th && r.station !== th.station) { r.warmth = r.energy = r.texture = 2; r.station = th.station; }
      r.theme = d.theme; if (wasDef) S.title = defaultTitle(r.station); return renderMake();
    }
    if (d.opening) { r.opening = d.opening; return renderMake(); }
    if (d.lpen) { S.aiPen = d.lpen; return renderMake(); }
    if (d.lheat) { S.aiHeat = d.lheat; return renderMake(); }
    if (d.ltalk) { S.aiTalk = d.ltalk; return renderMake(); }
    if (d.lview) { S.aiView = d.lview; return renderMake(); }
    if (d.lhook) { S.aiHook = !S.aiHook; return renderMake(); }
    if (d.leng) { S.aiEng = S.aiEng === d.leng ? 'none' : d.leng; return renderMake(); }
    if (d.st) { S.stGroup = null; r.theme = 'none'; if (r.station !== d.st) { const wasDef = S.title === defaultTitle(r.station); r.station = d.st; r.warmth = r.energy = r.texture = 2; if (wasDef) S.title = defaultTitle(d.st); ls.set('yarr_web_studio_station', d.st); } return renderMake(); }
    if (d.genre) { r.genre = d.genre; return renderMake(); }
    if (t.id === 'mMoreG') { S.moreGenres = !S.moreGenres; return renderMake(); }
    if (d.vcat) { S.voiceCat = d.vcat; return renderMake(); }
    if (d.tone) { S.tone = d.tone; S.voiceCat = VOICES.find((v) => v.id === d.tone)?.cat || S.voiceCat; return renderMake(); }
    if (d.lead) { r.lead = d.lead; return renderMake(); }
    if (d.flow) { r.flow = d.flow; return renderMake(); }
    if (d.daily) { // 🎲 오늘의 레시피 채우기 (2026-11-10)
      const x = dailyPick();
      S.recipe = { ...newRecipe(x.station), genre: x.genre, flow: x.flow, weather: x.weather, time: x.time, theme: x.vocal ? x.theme : 'none', spark: x.spark, daily: x.key };
      S.vocal = x.vocal; if (x.vocal) S.byTheme = x.theme !== 'none';
      S.title = x.title; S.dailyOn = x.key; err('');
      renderMake(); B.toast(x.vocal ? '오늘의 레시피를 채웠어요. 이야기 한 줄을 적거나 AI 작사를 누르고 만들어 보세요' : '오늘의 레시피를 채웠어요. 아래에서 만들기를 누르면 돼요');
      return;
    }
    if (d.spark) { r.spark = !r.spark; return renderMake(); }
    if (d.weather) { r.weather = d.weather; return renderMake(); }
    if (d.time) { r.time = d.time; return renderMake(); }
    if (d.dur) { r.duration = +d.dur; return renderMake(); }
    if (d.lang) { S.aiLang = d.lang; return renderMake(); }
    if (d.lform) { S.aiForm = d.lform; return renderMake(); }
    if (d.tune) { const [k, v] = d.tune.split(':'); if (+v) S.tune[k] = +v; else delete S.tune[k]; return renderMake(); }
    if (d.adlib) { S.adlib = S.adlib.includes(d.adlib) ? S.adlib.filter((x) => x !== d.adlib) : [...S.adlib, d.adlib]; t.classList.toggle('on'); return; }
    if (d.npos) { S.narr.pos = d.npos; return renderMake(); }
    if (d.ntone) { S.narr.tone = d.ntone; return renderMake(); }
    if (d.nvoice) { S.narr.voice = d.nvoice; return renderMake(); }
    if (t.id === 'mPro') { S.pro = !S.pro; return renderMake(); }
    if (t.id === 'mAllVoices') { // 앱처럼: 프로 컨트롤을 열고 지금 목소리의 탭으로 (2026-11-08)
      S.pro = true; S.voiceCat = VOICES.find((v) => v.id === S.tone)?.cat || 'f'; renderMake();
      return root.querySelector('[data-vcat]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (t.id === 'mEditLy') { S.pro = true; renderMake(); root.querySelector('[data-ly="v"]')?.focus(); return; }
    if (t.id === 'mBridge') { S.bridgeOn = !S.bridgeOn; return renderMake(); }
    if (t.id === 'mPhotoX') { S.photo = null; return renderMake(); }
    if (t.id === 'mAi') return aiSheet(); // 앱처럼 창을 띄워 언어 · 구조 · 스타일을 고르고 써요 (2026-11-08)
    if (t.id === 'mUnfork') { S.parent = null; return renderMake(); }
    if (t.id === 'mFresh') { freshStart(); return renderMake(); }
    if (t.id === 'mAiBridge') return aiBridge();
    if (t.id === 'mGo') return go();
  };
  // 어댑립 칩 켜짐 표시
  el.querySelectorAll('[data-adlib]').forEach((b) => b.classList.toggle('on', S.adlib.includes(b.dataset.adlib)));
  el.oninput = (e) => {
    const t = e.target;
    if (t.id === 'mTitle') S.title = t.value;
    if (t.id === 'mStory') { S.story = t.value; const n = root.querySelector('#mStoryN'); if (n) n.textContent = t.value.length; }
    if (t.dataset.ly) { S.ly[t.dataset.ly] = t.value; }
    if (t.id === 'mNarr') S.narr.text = t.value;
    if (t.dataset.knob) { S.recipe[t.dataset.knob] = +t.value; const bb = root.querySelector('#mBpm'); if (bb) bb.textContent = `${bpmOf(S.recipe)} BPM`; }
    goBtn();
  };
  el.onchange = async (e) => {
    const t = e.target;
    if (t.dataset.ly || t.id === 'mNarr' || t.dataset.knob) return renderMake();
    if (t.id === 'mConsent') { S.consent = t.checked; return goBtn(); }
    if (t.id === 'mCompose') {
      S.composeOn = t.checked;
      if (S.composeOn && !S.draft) { S.draft = new ComposeDraft(); S.draft.loadExample(); }
      return renderMake();
    }
    if (t.id === 'mPhoto' && t.files?.[0]) {
      try { S.photo = await photoOf(t.files[0]); } catch (x) { err(x.message); }
      return renderMake();
    }
  };
}
function mountSeq() {
  const host = root.querySelector('#mSeq'); if (!host) return;
  seq = mountSequencer(host, {
    draft: S.draft, bpm: () => Math.min(180, Math.max(60, bpmOf(S.recipe))), vocal: () => S.vocal, toast: B.toast,
    // 🎲 자동 찍기 장르: 고른 장르 · '자동'이면 스테이션 장르 (서버 가사 말투와 같은 규칙)
    genre: () => (S.recipe.genre && S.recipe.genre !== 'auto' ? S.recipe.genre : (GENRES.find((g) => g[0] !== 'auto' && g[1] === ST[S.recipe.station]?.ko)?.[0] || 'pop')),
    beforePlay: () => { B.pauseMain(); stopTake(); },
    onChange: () => { const l = root.querySelector('.lcd-1'); if (l) l.textContent = l.textContent.replace(/ · MY MELODY .*$/, '') + ' · MY MELODY ' + S.draft.chords.join('-'); },
    onClose: () => { S.composeOn = false; renderMake(); },
  });
}
async function photoOf(file) {
  const img = await createImageBitmap(file).catch(() => { throw new Error('사진을 열지 못했어요. 다른 사진을 골라 주세요.'); });
  const w = 512, h = Math.max(1, Math.round(img.height * 512 / img.width));
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
  const url = c.toDataURL('image/png'), data = url.split(',')[1];
  if (data.length * 0.75 > 850000) throw new Error('사진이 너무 커요. 다른 사진을 골라 주세요.');
  return { media: 'image/png', data, url };
}

// ---------- AI 작사 ----------
// ---------- ✨ AI 작사 창 (앱 _aiWrite 시트와 같아요 · 2026-11-08) ----------
function aiSheet() {
  document.getElementById('aiSheet')?.remove();
  const w = document.createElement('div'); w.id = 'aiSheet';
  w.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center;padding:16px;overflow:auto';
  let topic = S.story.trim();
  const draw = () => {
    w.innerHTML = `<div class="st-card" style="max-width:640px;width:100%;margin:auto;max-height:92vh;overflow:auto">
      <div style="font-size:17px;font-weight:800">✨ AI 작사</div>
      <p class="st-note" style="margin:4px 0 10px">어떤 이야기를 노래로 만들까요? 한 줄로 적으면 AI가 위에서 고른 장르 · 목소리 · 날씨 · 시간 · 곡 흐름에 맞춰 가사를 써요. 누를 때마다 다른 시점 · 다른 이야기로 써요.</p>
      <div class="chips">${chips([['ko', '한국어'], ['en', 'English'], ['ja', '日本語']], S.aiLang, 'data-lang')}</div>
      <div class="chips" style="margin-top:6px">${chips([['short', '짧게 · 절 2줄'], ['basic', '기본 · 절 4줄'], ['long', '길게 · 1절 + 2절']], S.aiForm, 'data-lform')}</div>
      <div class="chips" style="margin-top:6px">${chips(LY_PENS, S.aiPen, 'data-lpen')}</div>
      <div class="chips" style="margin-top:6px">${chips(LY_HEATS, S.aiHeat, 'data-lheat')}</div>
      <div class="chips" style="margin-top:6px">${chips(LY_TALKS, S.aiTalk, 'data-ltalk')}</div>
      <div class="chips" style="margin-top:6px">${chips(LY_VIEWS, S.aiView, 'data-lview')}</div>
      <div class="chips" style="margin-top:6px"><button class="chip-b${S.aiHook ? ' on' : ''}" data-lhook="1">🔁 후렴 반복 강조</button>${S.aiLang !== 'en' ? `<button class="chip-b${S.aiEng === 'one' ? ' on' : ''}" data-leng="one">🔤 영어 한마디</button><button class="chip-b${S.aiEng === 'mix' ? ' on' : ''}" data-leng="mix">🔤 영어 중간중간 섞기</button>` : ''}</div>
      <textarea class="st-ta" id="aiTopic" maxlength="150" style="min-height:64px;margin-top:10px;width:100%;box-sizing:border-box" placeholder="예: 퇴근길 버스에서 나를 위로하는 노래">${esc(topic)}</textarea>
      <div class="st-cnt"><span id="aiTopicN">${topic.length}</span>/150</div>
      <p class="st-note" style="margin:0 0 12px">가수 · 곡 이름이나 기존 노래 가사는 넣을 수 없어요. AI가 쓴 가사를 그대로 쓰면 매장에서도 틀어질 수 있고, 한 글자라도 고치면 직접 쓴 가사가 돼요.</p>
      <button class="btn st-go" id="aiGo">✨ 가사 쓰기</button>
      <button class="seq-key" id="aiClose" style="margin-top:8px;width:100%">닫기</button>
    </div>`;
    const ta = w.querySelector('#aiTopic'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  };
  w.oninput = (e) => { if (e.target.id === 'aiTopic') { topic = e.target.value; const n = w.querySelector('#aiTopicN'); if (n) n.textContent = topic.length; } };
  w.onclick = (e) => {
    if (e.target === w || e.target.closest('#aiClose')) return w.remove();
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if (b.id === 'aiGo') {
      topic = (w.querySelector('#aiTopic')?.value || '').trim();
      if (topic.length < 2 && !S.photo) return B.toast('어떤 이야기를 노래로 만들지 한 줄 적거나 사진을 붙여 주세요');
      w.remove(); S.story = topic; renderMake(); return aiWrite(false); // 고친 문장은 위 칸에도 그대로 (앱과 같아요)
    }
    if (d.lang) S.aiLang = d.lang; else if (d.lform) S.aiForm = d.lform; else if (d.lpen) S.aiPen = d.lpen; else if (d.lheat) S.aiHeat = d.lheat;
    else if (d.ltalk) S.aiTalk = d.ltalk; else if (d.lview) S.aiView = d.lview; else if (d.lhook) S.aiHook = !S.aiHook; else if (d.leng) S.aiEng = S.aiEng === d.leng ? 'none' : d.leng; else return;
    topic = w.querySelector('#aiTopic')?.value ?? topic; draw();
  };
  w.onkeydown = (e) => { if (e.key === 'Escape') w.remove(); if (e.key === 'Enter' && e.target.id === 'aiTopic' && !e.shiftKey) { e.preventDefault(); w.querySelector('#aiGo')?.click(); } };
  document.body.appendChild(w); draw();
}

async function aiWrite(quiet) {
  const topic = S.story.trim();
  if (topic.length < 2 && !S.photo) return err('어떤 이야기를 노래로 만들지 한 줄 적거나 사진을 붙여 주세요');
  const mine = hasLines() && normLyrics(S.ly.v, S.ly.c, S.bridgeOn ? S.ly.b : '') !== S.aiDraft;
  if (!quiet && mine && !confirm('지금 가사를 바꿀까요?\n적어 둔 가사가 AI가 쓴 가사로 바뀌어요.')) return;
  S.aiBusy = true; err(''); goBtn();
  const ai = root.querySelector('#mAi'); if (ai) ai.innerHTML = '<span class="spin"></span>';
  try {
    const j = await call('lyrics', { topic, station: S.recipe.station, genre: S.recipe.genre, bridge: S.bridgeOn, lang: S.aiLang, form: S.aiForm, recipe: S.recipe, vocal: S.tone, style: { talk: S.aiTalk, view: S.aiView, hook: S.aiHook, eng: S.aiLang !== 'en' && S.aiEng !== 'none' ? S.aiEng : false, pen: S.aiPen, heat: S.aiHeat }, ...(S.photo ? { image: { media: S.photo.media, data: S.photo.data } } : {}) }, 60000);
    S.ly = { v: (j.verse || []).join('\n'), c: (j.chorus || []).join('\n'), b: S.bridgeOn ? (j.bridge || []).join('\n') : S.ly.b };
    S.aiDraft = normLyrics(S.ly.v, S.ly.c, S.bridgeOn ? S.ly.b : '');
    if (j.title && (!S.title.trim() || S.title === defaultTitle(S.recipe.station))) S.title = String(j.title).slice(0, 60);
    S.consent = false;
    B.toast('AI가 가사를 썼어요 · 확인하고 [필수] 동의에 체크해 주세요');
  } catch (x) { err(x.message); } finally { S.aiBusy = false; renderMake(); }
}
async function aiBridge() {
  if (!lines(S.ly.v).length || !lines(S.ly.c).length) return B.toast('절과 후렴을 먼저 채워 주세요');
  const wasAi = S.aiDraft != null && (S.aiDraft === normLyrics(S.ly.v, S.ly.c, '') || S.aiDraft === normLyrics(S.ly.v, S.ly.c, S.ly.b));
  try {
    const j = await call('lyrics', { mode: 'bridge', verse: S.ly.v, chorus: S.ly.c, station: S.recipe.station, genre: S.recipe.genre, lang: lyricLang(S.ly.v + S.ly.c), recipe: S.recipe, vocal: S.tone }, 60000);
    S.ly.b = (j.bridge || []).join('\n');
    if (j.ai && wasAi) S.aiDraft = normLyrics(S.ly.v, S.ly.c, S.ly.b);
    B.toast(j.ai && wasAi ? 'AI가 브릿지를 썼어요 · 전체가 AI 가사라 매장에도 나가요' : 'AI가 브릿지를 썼어요');
  } catch (x) { err(x.message); }
  renderMake();
}

// ---------- 만들기 ----------
async function go() {
  if (S.vocal && !hasLines()) return aiWrite(true);
  if (!S.title.trim()) return err('곡 제목을 적어 주세요');
  if (S.composeOn && !(S.draft && S.draft.ready)) return err('직접 찍기: 음표를 3개 이상 찍거나, 직접 찍기를 꺼 주세요');
  const text = S.vocal ? '내 가사로 보컬곡 1곡을 만들어요. 마음에 안 들면 같은 가사로 다른 버전을 한 번 더 만들 수 있어요 (추가 횟수 없이).' : '먼저 1곡을 만들어요. 마음에 안 들면 같은 레시피로 다른 버전을 한 번 더 만들 수 있어요 (추가 횟수 없이).';
  if (!confirm(`이 레시피로 만들까요?\n\n${text} ${q?.useLine || ''}`)) return;
  S.busy = true; err(''); goBtn();
  try {
    const bodyJ = { recipe: S.recipe, title: S.title.trim(), ...(S.composeOn && S.draft ? { compose: S.draft.toJson() } : {}), ...(S.parent ? { parent: S.parent.id } : {}) };
    if (S.vocal) Object.assign(bodyJ, { mode: 'vocal', lyrics: { verse: S.ly.v, chorus: S.ly.c, ...(S.bridgeOn && S.ly.b.trim() ? { bridge: S.ly.b } : {}) }, vocal: S.tone, adlib: S.adlib, ...(Object.keys(S.tune).length ? { voiceTune: S.tune } : {}), consent: S.consent, ...(S.narr.pos !== 'none' ? { narration: S.narr } : {}) });
    const j = await call('make', bodyJ);
    S.batch = j.batch; ls.set('studio_batch', j.batch);
    if (q) { q.left -= 1; if (q.freeLeft <= 0 && q.bonusLeft > 0) q.bonusLeft -= 1; q.freeLeft = Math.max(0, q.freeLeft - 1); }
    S.status = { takes: [], prompt: j.prompt, bpm: j.bpm, title: S.title, vocal: S.vocal, genre: j.genre };
    S.sel = null; S.done = null; S.donate = false;
    seq?.stop(); startPoll(); renderResult();
  } catch (x) { err(x.message); } finally { S.busy = false; goBtn(); }
}

// ---------- 상태 확인 (이걸 불러야 서버가 다음 단계로 진행해요) ----------
function startPoll() { stopPoll(); S.polls = 0; S.startedAt = Date.now(); S.timer = setInterval(check, 10000); }
function stopPoll() { clearInterval(S.timer); S.timer = 0; }
const waiting = () => !S.status?.takes?.length || S.status.takes.some((t) => t.status === 'SUBMITTED' || t.status === 'RESERVED');
async function check() {
  if (S.checking || !S.batch) return;
  S.checking = true; S.polls++;
  try {
    const j = await call('make-status', { batch: S.batch }, 60000);
    if (ST[j.station] && S.title === defaultTitle(S.recipe.station)) S.title = j.title;
    S.status = j; if (j.station && ST[j.station]) S.recipe.station = j.station;
    if (!S.startedAt) S.startedAt = Date.now();
    if (j.takes.some((t) => t.status === 'PICKED')) { stopPoll(); ls.set('studio_batch', null); S.done = S.done || { title: j.title, vocal: j.vocal }; }
    else if (!waiting()) { stopPoll(); if (j.takes.every((t) => t.status === 'FAILED')) ls.set('studio_batch', null); }
    else if (!S.timer) S.timer = setInterval(check, 10000);
  } catch (x) {
    if (x.code === 'NOT_FOUND') { ls.set('studio_batch', null); S.batch = null; S.status = null; stopPoll(); S.checking = false; return renderMake(); }
    if (S.polls > 300) stopPoll();
  } finally { S.checking = false; }
  if (S.view === 'make') renderResult();
}

// ---------- 결과 · 고르기 ----------
function renderResult() {
  if (S.view !== 'make') return;
  if (!S.batch && !S.done) return renderMake();
  seq?.destroy(); seq = null;
  const st = S.status || { takes: [] }, vocal = st.vocal ?? S.vocal, takes = st.takes || [];
  header();
  if (S.done) {
    body().innerHTML = `<div class="st-grid one"><div class="st-card" style="max-width:640px">
      <h3 style="font-size:22px">올렸어요! 🎉</h3>
      <p class="st-note">${S.done.vocal ? "자동 검수가 고른 구간을 자르고 음량을 맞춰요. 보컬곡은 운영팀이 직접 들어 보고 승인하면 바로 공개돼요. 어디에 나가는지는 '내 곡'에서 볼 수 있어요." : "자동 검수가 고른 구간을 자르고 음량을 맞춘 뒤 승인되면 바로 공개돼요. 보통 몇 분 걸리고, 어디에 나가는지는 '내 곡'에서 볼 수 있어요."}</p>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn sub" data-r="mine">내 곡 보기</button><button class="btn" data-r="again">${q && q.left > 0 ? '하나 더 만들기' : '만들기 화면으로'}</button></div>
    </div></div>`;
    body().onclick = (e) => { const b = e.target.closest('[data-r]'); if (!b) return; if (b.dataset.r === 'again') restart(); else root.querySelector('#stTabs [data-v="mine"]').click(); };
    return;
  }
  if (waiting()) {
    const sec = (Date.now() - S.startedAt) / 1000, expect = vocal ? 210 : 160;
    const p = Math.max(0.02, Math.min(0.95, 1 - Math.exp(-2.2 * sec / expect)));
    const stage = p < 0.18 ? (vocal ? '가사에 맞춰 레시피를 정리하는 중…' : '레시피를 정리하는 중…') : p < 0.7 ? (vocal ? '작곡하고 노래를 녹음하는 중…' : '작곡하고 연주를 녹음하는 중…') : (vocal ? '목소리를 확인하고 음량을 맞추는 중…' : '음량을 맞추고 마무리하는 중…');
    const lyr = takes[0]?.lyrics || (vocal ? ['[Verse]', S.ly.v, '', '[Chorus]', S.ly.c].join('\n') : '');
    body().innerHTML = `<div class="st-grid${vocal ? '' : ' one'}"><div class="st-card">
      <div class="lcd"><div class="lcd-1">MAKING…  ${st.bpm || bpmOf(S.recipe)} BPM</div><div class="lcd-2">${esc(st.prompt || '')}</div></div>
      <h3 style="margin-top:18px"><span class="spin"></span> AI가 곡을 만들고 있어요 (약 ${Math.round(p * 100)}%)</h3>
      <div class="oa-deck"><div class="oa-top"><span class="oa-lamp"></span><b>ON AIR · MAKING</b><span class="oa-tc">${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')} / ~${String(Math.floor(expect / 60)).padStart(2, '0')}:${String(expect % 60).padStart(2, '0')}</span></div>
        <div class="oa-vu${st.ahead > 0 ? ' idle' : ''}"><span>L</span><i><u></u></i></div><div class="oa-vu r${st.ahead > 0 ? ' idle' : ''}"><span>R</span><i><u></u></i></div>
        <div class="oa-prog">${Array.from({ length: 24 }, (_, i) => `<b${i < Math.round(p * 24) ? ' class="on"' : ''}></b>`).join('')}</div></div>
      ${st.ahead > 0 ? `<div class="lcd" style="margin-top:10px"><div class="lcd-1">앞에 ${Number(st.ahead) | 0}곡 대기 중</div><div class="lcd-2">차례가 오면 바로 시작해요</div></div>` : ''}
      <p class="st-note">${st.ahead > 0 ? '순서를 기다리는 중…' : stage}</p>
      <p class="st-note">보통 2~5분, 붐비는 시간에는 20분까지 걸려요. 화면을 닫아도 계속 만들어지고, 다시 열면 이어서 볼 수 있어요.${sec > 60 ? ` · ${Math.floor(sec / 60)}분째 기다리는 중` : ''}</p>
      <button class="btn sub" data-r="chart" style="margin-top:8px">기다리는 동안 인기 차트 듣기</button>
    </div>${vocal && lyr ? `<div class="st-card"><h3>이 곡의 가사</h3><div class="lyr">${esc(lyr)}</div></div>` : ''}</div>`;
    body().onclick = (e) => { if (e.target.closest('[data-r="chart"]')) document.querySelector('.tabs [data-tab="chart"]')?.click(); };
    clearTimeout(renderResult.t); renderResult.t = setTimeout(() => { if (S.view === 'make' && waiting() && S.batch) renderResult(); }, 3000);
    // 타임코드는 1초마다 (화면 전체는 3초마다 새로 그려요)
    clearInterval(renderResult.tc); renderResult.tc = setInterval(() => {
      const el = root.querySelector('.oa-tc'); if (!el || !waiting()) return clearInterval(renderResult.tc);
      const s2 = (Date.now() - S.startedAt) / 1000, mm = (x) => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(Math.floor(x % 60)).padStart(2, '0');
      el.textContent = `${mm(s2)} / ~${mm(expect)}`;
    }, 1000);
    return;
  }
  if (takes.length && takes.every((t) => t.status === 'FAILED')) {
    body().innerHTML = `<div class="st-card" style="max-width:640px"><h3>이번에는 만들지 못했어요</h3><p class="st-note">오늘 횟수는 쓰지 않았으니 다시 만들어 보세요. 문제가 계속되면 문의해 주세요.</p><button class="btn" data-r="again" style="margin-top:12px">처음으로</button></div>`;
    body().onclick = (e) => { if (e.target.closest('[data-r="again"]')) restart(); };
    return;
  }
  const ready = takes.filter((t) => t.status === 'READY');
  const sel = takes.find((t) => t.id === S.sel);
  const len = sel?.duration || st.duration || S.recipe.duration;
  const nonFailed = takes.filter((t) => t.status !== 'FAILED').length;
  const canMore = !waiting() && ready.length && nonFailed < (q?.maxTakes ?? 2);
  const usedUp = !waiting() && ready.length && !sel && nonFailed >= (q?.maxTakes ?? 2); // 테이크를 다 썼고 아직 고르지 않았어요 (2026-11-08)
  const base = takes[0];
  const label = (t) => t.status === 'READY' && t.repaint ? `테이크 ${t.take} · ${fmt(t.repaint.start)}~${fmt(t.repaint.end)} 구간을 다시 만든 버전` : t.status === 'READY' ? (t.edited ? `테이크 ${t.take} · 고친 버전` : t.take === 1 ? '테이크 1 (리듬 편곡 · 그루브 중심)' : `테이크 ${t.take} (선율 편곡 · 멜로디 중심)`) : t.status === 'FAILED' ? `테이크 ${t.take} · 만들지 못했어요` : `테이크 ${t.take} · 만드는 중…`;
  const keep = S.range[1] - S.range[0];
  const other = ready.some((t) => t.id !== S.sel);
  body().innerHTML = `<div class="st-grid">
    <div class="st-card">
      <span class="chip o">TAKES READY</span><h3 style="font-size:20px;margin-top:8px">만들기 완료! · ${esc(S.title || st.title)}</h3>
      <p class="st-note">${st.bpm} BPM · ${esc(st.genre || '')}${vocal ? ' · 보컬' : ''}</p>
      <div class="takes" style="margin-top:12px">${takes.map((t) => `<div class="take${t.id === S.sel ? ' ok' : ''}">
        <button class="tp" data-play="${t.id}" ${t.status === 'READY' && t.url ? '' : 'disabled'}>${playingTake === t.id ? '■' : '▶'}</button>
        <div><b>${esc(label(t))}</b><small>${t.status === 'READY' ? (t.voice ? esc(voiceLabel(t.voice)) + ' · ' : '') + `${t.duration || st.duration}초` : t.status === 'FAILED' ? esc(t.error || '') : '조금만 기다려 주세요'}</small><div class="sq-bar"><i id="tb_${t.id}"></i></div></div>
        ${t.status === 'READY' ? `<button class="btn ${t.id === S.sel ? '' : 'sub'}" data-sel="${t.id}" style="padding:9px 14px;font-size:13px">${t.id === S.sel ? '이걸로 결정' : '이 버전 선택'}</button>` : ''}
      </div>${t.status === 'READY' && (canMore || vocal) ? `<div class="take-tools">${t.repaint && takes.some((x) => x.id === t.repaint.from && x.url) ? `<button class="seq-key${ab?.id === t.id ? ' on' : ''}" data-ab="${t.id}">${ab?.id === t.id ? '■ 비교 멈추기' : '🎧 바뀐 구간 비교 듣기'}</button>` : ''}${canMore ? `<button class="seq-key" data-rp="${t.id}">✂ 구간 다시 만들기</button>` : ''}${vocal ? (S.stemLinks?.[t.id] ? `<a class="seq-key" href="${esc(S.stemLinks[t.id].vocals)}" target="_blank" rel="noopener">🎤 보컬 받기</a><a class="seq-key" href="${esc(S.stemLinks[t.id].backing)}" target="_blank" rel="noopener">🎹 반주 받기</a><span class="ai-mark" title="AI 기본법에 따라 AI로 만든 음원임을 파일에 표시해요">🤖 AI로 만든 음원 · 파일 정보에 'Generated with YARR AI (yarrmusic.com)'가 들어가요</span>` : `<button class="seq-key" data-stems="${t.id}" ${S.stemsBusy?.[t.id] ? 'disabled' : ''}>${S.stemsBusy?.[t.id] ? '나누는 중… (1~3분)' : t.stems === 'READY' ? '🎤🎹 나눈 파일 받기' : t.stems === 'FAILED' ? '🎚 다시 나누기 (지난번 실패)' : t.stems === 'RUNNING' ? '🎚 나누는 중 · 눌러서 확인' : '🎚 보컬 · 반주 따로'}</button>`) : ''}</div>` : ''}${
        ab?.id === t.id ? `<div class="ab-box"><span>지금 듣는 것 <b>${ab.phase === 0 ? '① 원래 버전' : '② 다시 만든 버전'}</b> · ${fmt(ab.a)}~${fmt(ab.b)} (바뀐 곳 ${fmt(t.repaint.start)}~${fmt(t.repaint.end)})</span><button class="seq-key" data-abswap="1">↔ 바꿔 듣기</button></div>` : ''}${
        S.rp === t.id && canMore ? rpBox(t, st) : ''}`).join('')}</div>
      ${canMore ? `<button class="btn st-go" data-r="edit" style="margin-top:14px">✏️ 고쳐서 다시 만들기 · 말로 해도 돼요</button>
        <button class="btn sub" data-r="more" style="width:100%;justify-content:center;margin-top:8px">선율 편곡 버전도 만들어 보기 · 같은 레시피 · 추가 횟수 없음</button>
        <p class="st-note">둘 중 하나만 만들 수 있어요 (이 곡의 두 번째 버전)</p>` : ''}
      ${usedUp ? `<div style="margin-top:12px;padding:14px;border-radius:14px;background:rgba(255,123,58,.12);border:1px solid rgba(255,123,58,.4)">
        <b style="font-size:14px">테이크 ${q?.maxTakes ?? 2}개를 다 썼어요 · 위에서 하나를 골라 주세요</b>
        <p class="st-note" style="margin:6px 0 10px">${q && q.left > 0 ? `이 곡은 더 고칠 수 없어요. 둘 다 마음에 안 들 때만 새 곡으로 다시 만들 수 있어요 (남은 횟수 1번 사용 · 지금 ${q.left}번 남음)` : `오늘 횟수를 다 썼어요. 횟수가 다시 채워지면 ${vocal ? '같은 가사로' : '같은 레시피로'} 새로 만들 수 있어요`}</p>
        <button class="btn sub" data-r="againsame" style="width:100%;justify-content:center"${q && q.left > 0 ? '' : ' disabled'}>${vocal ? '같은 가사로 새로 만들기' : '같은 레시피로 새로 만들기'}</button>
        <button class="btn sub" data-r="againchange" style="width:100%;justify-content:center;margin-top:8px"${q && q.left > 0 ? '' : ' disabled'}>${vocal ? '장르 · 목소리 바꿔서 새로 만들기' : '장르 · 분위기 바꿔서 새로 만들기'}</button>
        ${vocal ? '' : `<button class="btn sub" data-r="againvocal" style="width:100%;justify-content:center;margin-top:8px"${q && q.left > 0 ? '' : ' disabled'}>🎤 가사 · 가수 넣어서 보컬곡으로 새로 만들기</button>`}</div>`
      : !sel && ready.length ? '<button class="seq-key" data-r="leave" style="margin-top:10px">이번 곡은 두고 새 레시피로 만들기</button>' : ''}
      ${vocal && base?.lyrics ? `<div class="st-q">이 곡의 가사</div><div class="lyr">${esc(base.lyrics)}</div>` : ''}
    </div>
    <div class="st-card ${sel ? '' : 'hidden'}">
      <div class="st-q" style="margin-top:0">남길 구간 (앞뒤 자르기 · 끝은 자동 페이드)</div>
      <div class="st-range"><span class="st-note" style="margin:0;width:44px">시작</span><input type="range" min="0" max="${Math.floor(len)}" step="1" value="${Math.floor(S.range[0])}" data-trim="0"><span class="lcdv">${fmt(S.range[0])}</span></div>
      <div class="st-range"><span class="st-note" style="margin:0;width:44px">끝</span><input type="range" min="0" max="${Math.floor(len)}" step="1" value="${Math.floor(S.range[1])}" data-trim="1"><span class="lcdv">${fmt(S.range[1])}</span></div>
      <p class="st-note ${keep < 60 ? 'st-err' : ''}" id="rKeep">${fmt(S.range[0])} ~ ${fmt(S.range[1])} · ${Math.round(keep)}초 남겨요</p>
      ${fitCard(keep)}
      <div class="st-q">곡 제목</div><input class="st-in" id="rTitle" maxlength="60" value="${esc(S.title || st.title || '')}">
      ${other && !vocal ? `<label class="st-check"><input type="checkbox" id="rDonate" ${S.donate ? 'checked' : ''}><span><b>고르지 않은 버전은 야르 스테이션 곡으로 기부할게요</b><br><span class="st-note" style="margin:0">YARR Originals 이름으로 스테이션 · 매장에 나가고, 내 곡 · 정산에는 포함되지 않아요. 체크하지 않으면 지워져요.</span></span></label>` : ''}
      <label class="st-check"><input type="checkbox" id="rPublic" ${S.recipePublic ? 'checked' : ''}><span><b>⚡ 레시피 공개</b><br><span class="st-note" style="margin:0">다른 사람이 이 곡의 세팅(장르 · 노브 · 목소리 · 멜로디)으로 변주할 수 있어요. 가사 · 곡 설명 원문은 공개되지 않고, 변주곡이 올라오면 원곡으로 표시되며 수익의 30%가 나에게 와요.</span></span></label>
      <label class="st-check"><input type="checkbox" id="rReg" ${S.notRegistered ? 'checked' : ''}><span><b>[필수] 이 곡은 음악 저작권 단체(음저협 등)에 등록하지 않았고, 저는 그 단체 회원이 아니에요</b><br><span class="st-note" style="margin:0">YARR 는 저작권 단체와 사용 계약이 없어서 등록된 곡은 차트 · 스테이션 · 매장에서 틀 수 없어요. 나중에 등록하려면 먼저 알려 주세요. 곡을 비공개로 돌려요.</span></span></label>
      <button class="btn st-go" data-r="pick" ${S.busy || keep < 60 || !S.notRegistered ? 'disabled' : ''}>이 테이크로 올리기</button>
    </div>
  </div>`;
  const el = body();
  el.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.play) return playTake(takes.find((t) => t.id === b.dataset.play));
    if (b.dataset.sel) { if (S.sel !== b.dataset.sel) { S.sel = b.dataset.sel; const t = takes.find((x) => x.id === S.sel); S.range = [0, t?.duration || st.duration || S.recipe.duration]; } return renderResult(); }
    const r = b.dataset.r;
    if (b.dataset.rp) { S.rp = S.rp === b.dataset.rp ? null : b.dataset.rp; const t = takes.find((x) => x.id === S.rp); const d = t?.duration || st.duration || 120; S.rpRange = [Math.min(30, d - 10), Math.min(50, d)];
      S.rpSec = { list: [], loading: true, exact: false, precise: false, finding: false, sel: null, edit: false, consent: false, style: null, text: '', polls: 0 };
      if (S.rp) loadSections(S.rp); return renderResult(); }
    // 구간 고치기 (앱 showSectionEditSheet 와 같아요 · 2026-11-08)
    if (b.dataset.rps !== undefined) { rpPickSection(+b.dataset.rps, takes.find((x) => x.id === S.rp), st); return renderResult(); }
    if (b.dataset.rpprec) { S.rpSec.finding = true; S.rpSec.polls = 0; loadSections(S.rp, true); return renderResult(); }
    if (b.dataset.rped) { S.rpSec.edit = !S.rpSec.edit; return renderResult(); }
    if (b.dataset.rpst) { S.rpSec.style = S.rpSec.style === b.dataset.rpst ? null : b.dataset.rpst; return renderResult(); }
    if (b.dataset.rplisten) return rpListen(takes.find((x) => x.id === S.rp));
    if (b.dataset.rpai) return rpAi(takes.find((x) => x.id === S.rp));
    if (b.dataset.stems) return stems(b.dataset.stems);
    if (b.dataset.ab) return abPlay(takes.find((t) => t.id === b.dataset.ab), takes);
    if (b.dataset.abswap && ab) { ab.swapped = true; return ab.go(1 - ab.phase, takeAudio?.currentTime ?? ab.a); }
    if (r === 'rpgo') return repaint();
    if (r === 'more') return more(null);
    if (r === 'edit') return editSheet();
    if (r === 'leave') { ls.set('studio_batch', null); freshStart(); return restart(); } // '새 레시피로' = 이전 가사 없이 새로
    // 연주곡 (2026-11-10): '같은 가사' 가 아니라 '같은 레시피' · 보컬곡으로 바꿔 만들기도
    if (!vocal && (r === 'againsame' || r === 'againchange')) return againInst(r === 'againchange', takes);
    if (r === 'againvocal') { const t0 = takes.find((x) => x.status === 'READY') || takes[0] || {}; return toVocal(t0.recipe || S.recipe, null); }
    if (r === 'againsame' || r === 'againchange') return againWith(r === 'againchange', takes);
    if (r === 'pick') return pick();
  };
  el.oninput = (e) => {
    const t = e.target;
    if (t.dataset.trim !== undefined) {
      const i = +t.dataset.trim; S.range[i] = +t.value;
      if (S.range[0] > S.range[1] - 1) { if (i === 0) S.range[0] = S.range[1] - 1; else S.range[1] = S.range[0] + 1; t.value = S.range[i]; }
      t.nextElementSibling.textContent = fmt(S.range[i]);
      const k = S.range[1] - S.range[0], kp = root.querySelector('#rKeep');
      kp.textContent = `${fmt(S.range[0])} ~ ${fmt(S.range[1])} · ${Math.round(k)}초 남겨요`; kp.classList.toggle('st-err', k < 60);
      root.querySelector('[data-r="pick"]').disabled = S.busy || k < 60 || !S.notRegistered;
    }
    if (t.dataset.rpr !== undefined) { S.rpRange[+t.dataset.rpr] = +t.value; t.nextElementSibling.textContent = fmt(+t.value); const k = S.rpRange[1] - S.rpRange[0], go = root.querySelector('[data-r="rpgo"]'); if (go) { go.textContent = `이 구간 다시 만들기 (${Math.round(k)}초) · 테이크 1개`; go.disabled = S.busy || !rpOk(S.status?.takes?.find((x) => x.id === S.rp)); } }
    if (t.id === 'rpLines') { S.rpSec.text = t.value; S.rpSec.aiText = false; rpRefresh(); return; }
    if (t.id === 'rTitle') S.title = t.value;
    if (t.id === 'rDonate') S.donate = t.checked;
    if (t.id === 'rPublic') S.recipePublic = t.checked;
  };
  el.onchange = (e) => { if (e.target.id === 'rDonate') S.donate = e.target.checked; if (e.target.id === 'rPublic') S.recipePublic = e.target.checked;
    // 신탁단체 미등록 확인 (2026-11-08 · 필수 · 앱과 같아요)
    if (e.target.id === 'rpConsent') { S.rpSec.consent = e.target.checked; rpRefresh(); }
    if (e.target.id === 'rReg') { S.notRegistered = e.target.checked; const b = root.querySelector('[data-r="pick"]'); if (b) b.disabled = S.busy || S.range[1] - S.range[0] < 60 || !S.notRegistered; } };
}
function playTake(t) {
  if (!t?.url) return;
  if (playingTake === t.id) { stopTake(); return renderResult(); }
  stopTake(); B.pauseMain(); seq?.stop();
  takeAudio = new Audio(t.url); playingTake = t.id;
  if (t.id === S.sel && S.range[0] > 1) takeAudio.currentTime = S.range[0];
  takeAudio.ontimeupdate = () => { const i = root.querySelector('#tb_' + t.id); if (i && takeAudio.duration) i.style.width = `${(takeAudio.currentTime / takeAudio.duration) * 100}%`; if (t.id === S.sel && takeAudio.currentTime >= S.range[1]) stopTake(); };
  takeAudio.onended = () => { stopTake(); renderResult(); };
  takeAudio.onerror = () => { stopTake(); B.toast('재생 주소가 만료됐어요. 잠시 뒤 다시 눌러 주세요.'); check(); };
  takeAudio.play().catch(() => {}); renderResult();
}
function stopTake() { if (takeAudio) { takeAudio.pause(); takeAudio = null; } playingTake = null; ab = null; }

/** 구간 다시 만들기 비교 듣기 (2026-11-05): 바뀐 구간 앞 4초 ~ 뒤 2초를 ① 원래 → ② 다시 만든 순서로 이어 틀어요
 *  ↔ 바꿔 듣기: 같은 시점에서 다른 버전으로 바로 바꿔요 (차이를 귀로 바로 비교) */
let ab = null;
function abPlay(t, takes) {
  if (!t?.repaint) return;
  if (ab?.id === t.id) { stopTake(); return renderResult(); }
  const src = takes.find((x) => x.id === t.repaint.from);
  if (!src?.url || !t.url) return B.toast('원래 테이크를 찾지 못했어요');
  stopTake(); B.pauseMain(); seq?.stop();
  const cur = { id: t.id, phase: 0, swapped: false, a: Math.max(0, t.repaint.start - 4), b: t.repaint.end + 2, urls: [src.url, t.url] };
  cur.go = (phase, at) => {
    if (ab !== cur) return;
    if (takeAudio) takeAudio.pause();
    const a = new Audio(cur.urls[phase]); takeAudio = a; cur.phase = phase;
    a.addEventListener('loadedmetadata', () => { if (takeAudio !== a) return; a.currentTime = Math.min(at, cur.b - 0.5); a.play().catch(() => {}); }, { once: true });
    a.ontimeupdate = () => {
      if (takeAudio !== a || ab !== cur || a.currentTime < cur.b) return;
      if (cur.phase === 0 && !cur.swapped) cur.go(1, cur.a); // ① 끝 → ② 같은 구간
      else { stopTake(); renderResult(); }
    };
    a.onerror = () => { if (takeAudio === a) { stopTake(); B.toast('재생 주소가 만료됐어요. 잠시 뒤 다시 눌러 주세요.'); check(); } };
    renderResult();
  };
  ab = cur;
  cur.go(0, cur.a);
}

async function more(edit) {
  try {
    // 고쳐서 다시 만들기에도 목소리 다듬기 값을 이어 보내요 (2026-11-05 · 고친 화면에서 따로 안 정했으면 지금 값)
    if (edit && !edit.voiceTune && Object.keys(S.tune || {}).length) edit = { ...edit, voiceTune: S.tune };
    const j = await call('make-more', { batch: S.batch, ...(edit ? { edit } : {}) });
    S.status.takes.push({ id: 'pending', take: j.take, status: 'SUBMITTED' });
    startPoll(); renderResult();
  } catch (x) { err(x.message); }
}
// ---------- 구간 고치기 (앱 take_edit_sheets.dart 와 같은 규칙 · 2026-11-08) ----------
const RP_STYLES = [['clearer', '🎙 발음 또렷하게'], ['stronger', '🔥 더 세게'], ['softer', '🌙 더 부드럽게'], ['emotional', '💧 더 감성적으로'], ['stripped', '🎸 악기 줄이기'], ['choir', '👥 코러스 쌓기'], ['rap', '🎤 랩으로'], ['drop', '🎆 클라이맥스']];
function parseBlocks(display) {
  const out = { verse: [], chorus: [], bridge: [], n: [] }; let cur = 'verse';
  for (const raw of String(display || '').replace(/\r/g, '').split('\n')) {
    const l = raw.replace(/\s+/g, ' ').trim(); if (!l) continue;
    const m = l.match(/^\[(verse|chorus|bridge|narration intro|narration break|narration outro)\]$/i);
    if (m) { const k = m[1].toLowerCase(); cur = k.startsWith('narration') ? 'n' : k; } else out[cur].push(l);
  }
  return out;
}
const secName = (s) => { const n = s.n || 1; return ({ intro: '전주', verse: `${n}절`, chorus: `후렴 ${n}`, bridge: '브릿지', narr: '나레이션', outro: '마무리', part: `파트 ${n}` })[s.key] || String(s.key); };
const rpCur = () => { const x = S.rpSec; return x && x.sel != null && x.sel < x.list.length ? x.list[x.sel] : null; };
/** 결과 화면에서 구간 고치기를 열어요 (고쳐서 다시 만들기 창에서 넘어올 때 · 구간 · 분위기 · 새 가사를 미리 골라 둬요) */
function openRepaint(t, preset = {}) {
  if (!t?.id) return;
  const d = t.duration || S.status?.duration || 120;
  S.rp = t.id; S.rpRange = [Math.min(30, d - 10), Math.min(50, d)];
  S.rpSec = { list: [], loading: true, exact: false, precise: false, finding: false, sel: null, edit: false, consent: false, style: preset.style || null, text: '', polls: 0, preset };
  loadSections(t.id); renderResult();
  setTimeout(() => root.querySelector('.rp-box')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
}
function rpPickSection(i, t, st) {
  const s = S.rpSec.list[i]; if (!s) return; const len = t?.duration || st.duration || 120;
  let a = Math.max(0, Math.min(len, +s.start || 0)), b = Math.max(0, Math.min(len, +s.end || len));
  if (b - a > 90) b = a + 90; if (b - a < 3) b = Math.min(len, a + 3);
  S.rpSec.sel = i; S.rpRange = [Math.round(a), Math.round(b)]; S.rpSec.text = (s.lines || []).join('\n'); if (s.block == null) S.rpSec.edit = false;
}
function rpNewLyrics(t) {
  const x = S.rpSec, s = rpCur(); if (!x?.edit || !s || s.block == null || !t) return null;
  const blocks = parseBlocks(t.lyrics), from = s.from ?? 0, to = s.to ?? (blocks[s.block]?.length ?? 0);
  const L = x.text.split('\n').map((l) => l.trim()).filter(Boolean);
  const b = { verse: [...blocks.verse], chorus: [...blocks.chorus], bridge: [...blocks.bridge] };
  const old = b[s.block]; b[s.block] = [...old.slice(0, from), ...L, ...old.slice(Math.min(to, old.length))];
  return Object.fromEntries(['verse', 'chorus', 'bridge'].filter((k) => b[k].length).map((k) => [k, b[k].join('\n')]));
}
function rpLyricsErr(t) {
  const l = rpNewLyrics(t); if (!l) return null;
  if (!S.rpSec.text.trim()) return '바꿀 가사를 한 줄 이상 써 주세요';
  const want = (rpCur()?.lines || []).length, got = S.rpSec.text.split('\n').filter((x) => x.trim()).length;
  if (want > 0 && got !== want) return `줄 수는 그대로 ${want}줄로 맞춰 주세요 (지금 ${got}줄)`;
  const p = lyricsProblem(l.verse || '', l.chorus || '', l.bridge || ''); return p ? errText(p) : null;
}
function rpOk(t) {
  const span = S.rpRange[1] - S.rpRange[0];
  return span >= 3 && span <= 90 && (!S.rpSec?.edit || (!rpLyricsErr(t) && S.rpSec.consent && rpNewLyrics(t) != null));
}
/** 입력 중에는 다시 그리지 않고 버튼 · 오류만 고쳐요 (글자 칸이 포커스를 잃지 않게) */
function rpRefresh() {
  const t = S.status?.takes?.find((x) => x.id === S.rp); const go = root.querySelector('[data-r="rpgo"]'), e = root.querySelector('#rpErr');
  if (e) e.textContent = rpLyricsErr(t) || ''; if (go) go.disabled = S.busy || !rpOk(t);
}
async function loadSections(id, precise = false) {
  try {
    const d = await call('make-sections', { make_id: id, ...(precise ? { precise: true } : {}) }, 60000);
    if (S.rp !== id || !S.rpSec) return;
    const x = S.rpSec; x.list = (d.sections || []).filter((v) => v && typeof v === 'object'); x.exact = !!d.exact; x.precise = !!d.precise; x.loading = false;
    const running = d.status === 'RUNNING'; x.finding = running;
    if (x.sel != null && x.sel < x.list.length) { const keep = x.text; rpPickSection(x.sel, S.status.takes.find((v) => v.id === id), S.status); x.text = keep; }
    if (x.preset?.key && !x.presetDone) { // 처음 한 번: 넘겨받은 구간을 고르고, 새로 쓴 가사가 있으면 그 줄을 채워요
      x.presetDone = true; const i = x.list.findIndex((v) => v.key === x.preset.key || v.block === x.preset.key);
      if (i >= 0) {
        rpPickSection(i, S.status.takes.find((v) => v.id === id), S.status); const sct = x.list[i];
        if (x.preset.lines && sct.block != null) { const all = lines(x.preset.lines), from = sct.from ?? 0, to = sct.to ?? all.length; if (to <= all.length) { x.text = all.slice(from, to).join('\n'); x.edit = true; x.aiText = true; } }
      }
    }
    if (running && x.polls < 24) { x.polls++; setTimeout(() => { if (S.rp === id) loadSections(id); }, 6000); } else if (running) x.finding = false;
  } catch (e) { if (S.rpSec) { S.rpSec.loading = false; S.rpSec.finding = false; } err(e.message); }
  if (S.rp === id) renderResult();
}
/** ✨ AI로 이 부분 다시 쓰기 (서버 lyrics rewrite · 줄 수 그대로 · 앱과 같아요) */
async function rpAi(t) {
  const x = S.rpSec, s = rpCur(); if (!x || !s || s.block == null || x.aiBusy || !t) return;
  const bl = parseBlocks(t.lyrics); x.aiBusy = true; renderResult();
  try {
    const rc = t.recipe || S.recipe;
    const j = await call('lyrics', { mode: 'rewrite', verse: bl.verse.join('\n'), chorus: bl.chorus.join('\n'), ...(bl.bridge.length ? { bridge: bl.bridge.join('\n') } : {}), block: s.block, from: s.from, to: s.to,
      station: rc.station || S.recipe.station, genre: rc.genre || 'auto', lang: lyricLang([...bl.verse, ...bl.chorus].join('\n')), recipe: rc, vocal: t.voice || S.tone }, 60000);
    x.text = (j.lines || []).join('\n'); x.aiText = true; x.edit = true;
  } catch (e) { err(e.message); }
  x.aiBusy = false; renderResult();
}
function rpListen(t) {
  if (!t?.url) return; const [a, b] = S.rpRange; stopTake(); playTake(t);
  setTimeout(() => { try { if (takeAudio) { takeAudio.currentTime = a; clearTimeout(rpListen.tm); rpListen.tm = setTimeout(() => { if (takeAudio && playingTake === t.id) { takeAudio.pause(); } }, (b - a) * 1000 + 300); } } catch {} }, 250);
}
function rpBox(t, st) {
  const x = S.rpSec || { list: [], loading: false }, vocal = !!String(t.lyrics || '').trim(), cur = rpCur(), canLy = vocal && cur?.block != null, max = Math.floor(t.duration || st.duration);
  const repeated = cur?.block === 'chorus' && x.list.filter((v) => v.key === 'chorus').length > 1;
  const span = Math.round(S.rpRange[1] - S.rpRange[0]);
  return `<div class="rp-box"><div class="st-note" style="margin:0 0 6px">고칠 구간을 고르면 그 부분만 새로 부르고 앞뒤는 그대로 둬요 · 테이크 1개를 써요 · 3~90초</div>
    ${x.loading ? '<div class="st-note"><span class="spin"></span> 구간을 찾는 중…</div>' : `<div class="chips">${x.list.map((v, i) => `<button class="chip-b${x.sel === i ? ' on' : ''}" data-rps="${i}">${esc(secName(v))} · ${fmt(+v.start || 0)}</button>`).join('')}</div>
    <div class="st-note" style="margin:6px 0">${x.finding ? '<span class="spin"></span> 노래를 듣고 가사 위치를 찾는 중이에요… (1분쯤)' : x.exact ? '✓ 노래를 듣고 맞춘 시간이에요' : 'ⓘ 가사 길이로 어림한 시간이에요 · 들어 보고 조금 옮겨 주세요'}${!x.exact && x.precise && !x.finding ? ' <button class="seq-key" data-rpprec="1">🎯 정확히 찾기</button>' : ''}</div>`}
    <div class="st-range"><span class="st-note" style="margin:0;width:44px">시작</span><input type="range" min="0" max="${max}" step="1" value="${S.rpRange[0]}" data-rpr="0"><span class="lcdv">${fmt(S.rpRange[0])}</span></div>
    <div class="st-range"><span class="st-note" style="margin:0;width:44px">끝</span><input type="range" min="0" max="${max}" step="1" value="${S.rpRange[1]}" data-rpr="1"><span class="lcdv">${fmt(S.rpRange[1])}</span></div>
    <button class="seq-key" data-rplisten="1">▶ 이 구간 듣기</button>
    ${vocal ? `<div style="margin-top:10px"><button class="chip-b${x.edit && canLy ? ' on' : ''}" data-rped="1" ${canLy ? '' : 'disabled'}>✏️ 이 부분 가사 바꿔서 부르기</button>
      <span class="st-note" style="margin-left:6px">${canLy ? '바꾼 가사로 이 구간만 다시 불러요' : '위에서 1절 · 후렴 · 브릿지 중 하나를 골라 주세요'}</span></div>` : ''}
    ${x.edit && canLy ? `<textarea class="st-ta" id="rpLines" style="min-height:90px;margin-top:8px" placeholder="${esc(secName(cur))} 가사 (한 줄에 한 소절)">${esc(x.text)}</textarea>
      <div style="text-align:right"><button class="seq-key" data-rpai="1" ${x.aiBusy ? 'disabled' : ''}>${x.aiBusy ? '<span class="spin"></span> 쓰는 중…' : '✨ AI로 이 부분 다시 쓰기 (줄 수 그대로)'}</button></div>
      <p class="st-note st-err" id="rpErr">${esc(rpLyricsErr(t) || '')}</p>
      ${repeated ? '<p class="st-warn">후렴은 곡에서 여러 번 나와요. 가사 표시는 모든 후렴이 바뀌지만 소리는 고른 구간만 새로 불러요.</p>' : ''}
      <label class="st-check"><input type="checkbox" id="rpConsent" ${x.consent ? 'checked' : ''}><span><b>${x.aiText ? '[필수] AI가 쓴 가사를 확인했고, 남의 노래 가사를 넣지 않았어요' : '[필수] 남의 가사를 베끼지 않고 직접 쓴 창작 가사예요'}</b></span></label>` : ''}
    <div class="st-q" style="margin-top:10px">분위기 바꾸기 <span class="r">고르지 않으면 같은 분위기로 다시</span></div>
    <div class="chips">${RP_STYLES.filter(([k]) => vocal || !['clearer', 'choir', 'rap'].includes(k)).map(([k, n]) => `<button class="chip-b${x.style === k ? ' on' : ''}" data-rpst="${k}">${esc(n)}</button>`).join('')}</div>
    <button class="btn" data-r="rpgo" style="margin-top:10px" ${S.busy || !rpOk(t) ? 'disabled' : ''}>이 구간 다시 만들기 (${span}초) · 테이크 1개</button>
    <p class="st-note" style="margin-top:6px">🎚 믹스 · 키 · 빠르기 바꾸기는 곧 열려요.</p></div>`;
}

// 구간 다시 만들기 · 보컬/반주 따로 받기 (2026-11-04 · 서버 make-repaint · make-stems)
async function repaint() {
  const [a, b] = S.rpRange;
  if (b - a < 3 || b - a > 90) return err(errText('REPAINT_RANGE'));
  try {
    const sec = S.rpSec, cur = rpCur(), nl = rpNewLyrics(S.status.takes.find((x) => x.id === S.rp));
    if (sec?.edit && (rpLyricsErr(S.status.takes.find((x) => x.id === S.rp)) || !sec.consent)) return err(rpLyricsErr(S.status.takes.find((x) => x.id === S.rp)) || '[필수] 창작 가사 확인에 체크해 주세요.');
    const j = await call('make-repaint', { make_id: S.rp, start: Math.round(a), end: Math.round(b),
      ...(sec?.edit && nl ? { lyrics: nl, consent: true } : {}), ...(sec?.style ? { style: sec.style } : {}), ...(cur ? { section: secName(cur) } : {}) });
    S.rp = null; S.rpSec = null; S.status.takes.push({ id: 'pending', take: j.take, status: 'SUBMITTED' });
    startPoll(); renderResult();
  } catch (x) { err(x.message); }
}
async function stems(id) {
  S.stemsBusy = { ...(S.stemsBusy || {}), [id]: true }; renderResult();
  try {
    for (let i = 0; i < 30; i++) {
      const j = await call('make-stems', { make_id: id }, 60000);
      if (j.status === 'READY') {
        S.stemLinks = { ...(S.stemLinks || {}), [id]: { vocals: j.vocals, backing: j.backing } };
        const tk = S.status?.takes?.find((x) => x.id === id); if (tk) tk.stems = 'READY';
        B.toast('보컬 · 반주가 준비됐어요 · 테이크 아래 🎤 보컬 받기 · 🎹 반주 받기 버튼을 눌러요 (주소는 1시간 동안 열려요)');
        break;
      }
      if (j.status === 'FAILED') { B.toast('보컬 · 반주를 나누지 못했어요. 한 번 더 눌러 주세요.'); err('보컬 · 반주를 나누지 못했어요. 한 번 더 눌러 주세요.'); break; }
      if (i === 29) B.toast('아직 나누는 중이에요 · 잠시 뒤 버튼을 다시 눌러 확인해 주세요');
      if (i === 0) B.toast('보컬과 반주를 나누는 중이에요 · 1~2분 걸려요');
      await new Promise((r) => setTimeout(r, 10000));
    }
  } catch (x) { err(x.message); }
  delete S.stemsBusy[id]; renderResult();
}
async function pick() {
  const t = S.status.takes.find((x) => x.id === S.sel); if (!t) return;
  const len = t.duration || S.status.duration || S.recipe.duration;
  if (S.range[1] - S.range[0] < 60) return err(errText('TRIM_TOO_SHORT'));
  if (!S.notRegistered) return err('[필수] 저작권 단체 미등록 확인에 체크해 주세요.');
  const whole = S.range[0] < 0.5 && S.range[1] > len - 0.5;
  const other = S.status.takes.some((x) => x.status === 'READY' && x.id !== S.sel);
  S.busy = true; stopTake(); renderResult();
  try {
    const title = (S.title || S.status.title || '').trim();
    const j = await call('make-pick', { make_id: t.id, title, donate: !!(S.donate && other && !S.status.vocal), ...(S.recipePublic ? { recipe_public: true } : {}), not_registered: true, ...(whole ? {} : { trim_start: S.range[0], trim_end: S.range[1] }) });
    S.parent = null; S.recipePublic = false; S.notRegistered = false;
    ls.set('studio_batch', null); S.batch = null;
    S.done = { title: j.title, vocal: S.status.vocal };
    B.toast(S.status.vocal ? `'${j.title}' 올렸어요 · 보컬곡은 운영팀이 들어 보고 승인하면 바로 공개돼요` : `'${j.title}' 올렸어요 · 자동 검수가 끝나면 바로 차트에 올라가요`);
  } catch (x) { err(x.message); } finally { S.busy = false; renderResult(); }
}
/** 같은 가사로 새로 만들기: 마지막으로 나온 테이크의 가사 · 목소리를 만들기 화면에 채워요 (오늘 횟수 1번 · 앱과 같아요) */
function againWith(change, takes) {
  const ready = (takes || []).filter((t) => t.status === 'READY'), last = ready[ready.length - 1];
  ls.set('studio_batch', null); if (S.status?.vocal) S.vocal = true;
  if (last) {
    const sp = splitLyrics(last.lyrics || '');
    if (sp.verse.trim() || sp.chorus.trim()) { S.ly = { v: sp.verse, c: sp.chorus, b: sp.bridge }; S.bridgeOn = !!sp.bridge.trim(); }
    if (last.voice && VOICES.some((v) => v.id === last.voice)) { S.tone = last.voice; S.voiceCat = VOICES.find((v) => v.id === last.voice).cat; }
  }
  S.carried = true;
  restart();
  B.toast(change ? '가사는 그대로 넣어 뒀어요. 장르나 목소리를 바꾸고 만들어 보세요' : '가사 · 목소리를 그대로 넣어 뒀어요. 아래에서 만들기를 누르면 새로 만들어요');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
/** 연주곡 다시 만들기: 그 곡의 레시피를 만들기 화면에 채워요 (오늘 횟수 1번) */
function againInst(change, takes) {
  const t0 = (takes || []).find((x) => x.status === 'READY') || (takes || [])[0] || {};
  ls.set('studio_batch', null);
  if (t0.recipe) S.recipe = { ...S.recipe, ...t0.recipe };
  S.vocal = false; S.carried = false;
  restart();
  B.toast(change ? '레시피를 넣어 뒀어요. 장르나 분위기를 바꾸고 만들어 보세요' : '같은 레시피를 넣어 뒀어요. 아래에서 만들기를 누르면 새로 만들어요');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
/** 연주곡 고치기 → 보컬곡으로 새로 만들기 (2026-11-10): 레시피는 그대로 · 보컬곡 켜고 · 목소리 골라 두기 · 가사는 비워요 */
function toVocal(r, g) {
  ls.set('studio_batch', null);
  S.recipe = { ...S.recipe, ...r, lead: 'auto' }; S.vocal = true;
  const want = g === 'f' ? 'f_clear' : g === 'm' ? 'm_soft' : null;
  if (want && VOICES.some((v) => v.id === want)) { S.tone = want; S.voiceCat = VOICES.find((v) => v.id === want).cat; }
  S.ly = { v: '', c: '', b: '' }; S.bridgeOn = false; S.carried = false; S.consent = false;
  restart();
  B.toast('보컬곡으로 바꿔 뒀어요. 가사를 쓰거나 AI 작사를 누른 뒤 만들어 보세요');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
/** 새로 시작: 주제 · 가사 · 제목을 비워요 (레시피 · 목소리 · 공간은 그대로 · 앱 make_screen _freshStart 와 같아요 · 2026-11-09) */
function freshStart() {
  S.ly = { v: '', c: '', b: '' }; S.bridgeOn = false; S.aiDraft = null; S.story = ''; S.carried = false; S.consent = false;
  S.title = defaultTitle(S.recipe.station);
}
function restart() {
  stopPoll(); stopTake();
  Object.assign(S, { batch: null, status: null, sel: null, done: null, donate: false, err: '', consent: false, parent: null, recipePublic: false, notRegistered: false });
  S.title = defaultTitle(S.recipe.station); ls.set('studio_batch', null);
  loadQuota(); renderMake();
}

// 고치기 창 오른쪽: 지금 레시피를 한눈에 · 바뀐 줄은 '전 → 후' 주황으로 (2026-11-10)
function recipePanel(a, b, n, vocal = false) {
  const L = Object.fromEntries(LEADS), F = Object.fromEntries(FLOWS);
  const meter = (v, was) => `<span class="ed-m">${[0, 1, 2, 3, 4].map((k) => `<i class="${k <= v ? 'on' : ''}${was != null && k <= was && k > v ? ' was' : ''}"></i>`).join('')}</span>`;
  const rows = [
    ['장르', GENRE[a.r.genre] || a.r.genre, GENRE[b.r.genre] || b.r.genre],
    ['바쁨', `${bpmOf(a.r)} BPM`, `${bpmOf(b.r)} BPM`, a.r.energy, b.r.energy],
    ['따뜻함', '', '', a.r.warmth, b.r.warmth],
    ['빈티지', '', '', a.r.texture, b.r.texture],
    ['악기', L[a.r.lead] || a.r.lead, L[b.r.lead] || b.r.lead],
    ['흐름', F[a.r.flow] || a.r.flow, F[b.r.flow] || b.r.flow],
    ['길이', `${a.r.duration}초`, `${b.r.duration}초`],
    ...(a.r.spark || b.r.spark ? [['실험', a.r.spark ? '켜짐' : '꺼짐', b.r.spark ? '켜짐' : '꺼짐']] : []),
    ...(vocal ? (() => {
      const AD = Object.fromEntries(ADLIBS), tuneTxt = (x) => VOICE_TUNE_ROWS.filter(([k]) => (x.tune || {})[k]).map(([k, nm, lo, hi]) => { const sd = x.tune[k] < 0 ? lo : hi; return sd.startsWith(nm) ? sd : `${nm} ${sd}`; }).join(' · ') || '자동';
      const adl = (x) => x.adlib.map((k) => String(AD[k] || k).replace(/\s*\(.*\)$/, '')).join(' · ') || '없음';
      return [['목소리', voiceLabel(a.tone), voiceLabel(b.tone)], ['다듬기', tuneTxt(a), tuneTxt(b)], ['추가', adl(a), adl(b)]];
    })() : []),
  ];
  return `<div class="ed-rc"><div class="ed-rh"><span>RECIPE</span><span>${n ? `바뀐 곳 ${n}` : '그대로'}</span></div>${rows.map(([k, x, y, va, vb]) => {
    const diff = x !== y || va !== vb;
    return `<div class="ed-r${diff ? ' d' : ''}"><span class="ed-k">${diff ? '●' : ''}${k}</span><span class="ed-v">${va != null ? meter(vb, diff ? va : null) : ''}${diff && x !== y ? `<s>${esc(x)}</s> → ` : ''}${esc(y)}</span></div>`;
  }).join('')}${n ? '<button class="ed-reset" id="eReset">처음 레시피로 되돌리기</button>' : '<p class="ed-tip">왼쪽 버튼을 누르거나 말로 적으면 여기 값이 바뀌어요</p>'}</div>`;
}

// ---------- 고쳐서 다시 만들기 (말로 · 버튼 값으로만 바뀌어요) ----------
function editSheet() {
  const st = S.status, t1 = st.takes[0] || {}, vocal = !!st.vocal;
  const base = { r: { ...newRecipe(), ...(t1.recipe || S.recipe) }, tone: t1.voice || S.tone, adlib: String(t1.adlib || '').split(',').filter(Boolean), tune: { ...(t1.voiceTune || t1.voice_tune || S.tune || {}) } };
  let cur = { r: { ...base.r }, tone: base.tone, adlib: [...base.adlib], tune: { ...base.tune } };
  const sp = splitLyrics(t1.lyrics || '');
  const ly = { v: sp.verse || S.ly.v, c: sp.chorus || S.ly.c, b: sp.bridge || '' };
  const ly0 = normLyrics(ly.v, ly.c, ly.b);
  const narr = { pos: 'none', tone: 'deep', voice: 'auto', text: '' };
  let consent = false, aiLy = false, busy = false, note = '', sec = null, secStyle = null;
  let vw = null; // 연주곡에 가사 · 가수를 원할 때: { g: 'f' | 'm' | null } → 보컬곡으로 새로 만들기 안내 (2026-11-10)
  // 앱 _EditSheet 와 같은 버튼 (2026-11-08 · 가사 다시 쓰기 · 브릿지 · '후렴만' 포함)
  // 2026-11-10 고치기 창 보강: 버튼을 묶음으로 (분위기 · 흐름 · 악기 · 장르 · 목소리 · 가사) · 모두 applyRequest 가 알아듣는 말
  const QG = [
    ['분위기', ['더 신나게', '더 잔잔하게', '더 따뜻하게', '더 차갑게', '더 빈티지하게', '더 깔끔하게']],
    ['흐름 · 길이', ['점점 고조되게', '리듬감 있게', '배경음악처럼 일정하게', '더 길게', '더 짧게']],
    ['악기', [['피아노로', 'piano'], ['기타로', 'guitar'], ['신스로', 'synth'], ['스트링으로', 'strings'], ['색소폰으로', 'sax'], ['전통악기로', 'korean']]],
    ['장르', [['로파이로', 'lofi'], ['재즈로', 'jazz'], ['시티팝으로', 'citypop'], ['어쿠스틱으로', 'acoustic'], ['앰비언트로', 'ambient'], ['하우스로', 'house'], ['보사노바로', 'bossa'], ['발라드로', 'kballad'], ['✨ 실험적으로', '__spark']]],
    ...(vocal ? [
      ['목소리', ['남자 목소리로', '여자 목소리로', '걸그룹으로', '합창으로', '고음으로', '더 감정 있게', '허밍 넣어 줘', '추임새 넣어 줘', '랩 넣어 줘', '랩 빼 줘']],
      ['가사 · 구성', ['가사 다시 써 줘', '더 시적으로 가사 다시', '추상적으로 가사 다시', '담담하게 가사 다시', '브릿지 넣어 줘', '후렴부터 시작', '후렴만 더 신나게', '후렴 가사만 바꿔 줘']],
    ] : [['보컬', [['🎤 보컬곡으로 새로 만들기', '__vocal']]]]),
  ];
  const secName = (k) => ({ verse: '절', bridge: '브릿지' })[k] || '후렴';
  const keyOf = { verse: 'v', chorus: 'c', bridge: 'b' };
  const lang = () => lyricLang(ly.v + '\n' + ly.c);
  async function lyricAsk(kind, text) {
    busy = true; note = kind === 'bridge' ? '브릿지를 쓰는 중이에요…' : kind === 'part' ? `${secName(sec)} 가사만 새로 쓰는 중이에요…` : '가사를 새로 쓰는 중이에요…'; draw();
    const r = cur.r;
    try {
      if (kind === 'bridge') {
        const j = await call('lyrics', { mode: 'bridge', verse: ly.v, chorus: ly.c, station: r.station, genre: r.genre, lang: lang(), recipe: r, vocal: cur.tone }, 60000);
        ly.b = (j.bridge || []).join('\n'); note = '브릿지 2줄을 넣었어요. 아래에서 고쳐도 돼요.';
      } else if (kind === 'part') {
        const j = await call('lyrics', { mode: 'rewrite', verse: ly.v, chorus: ly.c, ...(ly.b.trim() ? { bridge: ly.b } : {}), block: sec, wish: text, station: r.station, genre: r.genre, lang: lang(), recipe: r, vocal: cur.tone }, 60000);
        ly[keyOf[sec]] = (j.lines || []).join('\n'); aiLy = true; note = `${secName(sec)} 가사만 새로 썼어요 (줄 수 그대로). 아래에서 고쳐도 돼요.`;
      } else {
        const req = text.replace(/\s+/g, ' ').trim(), title = String(S.title || st.title || '').trim();
        const n = lines(ly.v).length, st2 = lyricStyleRequest(text);
        const j = await call('lyrics', { topic: (title ? `${title} · ${req}` : req).slice(0, 80), station: r.station, genre: r.genre, bridge: !!ly.b.trim(), lang: lang(), form: n >= 6 ? 'long' : n <= 2 ? 'short' : 'basic', recipe: r, vocal: cur.tone,
          style: { ...(st2.pen ? { pen: st2.pen } : {}), ...(st2.heat ? { heat: st2.heat } : {}) } }, 60000);
        ly.v = (j.verse || []).join('\n'); ly.c = (j.chorus || []).join('\n'); ly.b = (j.bridge || []).join('\n'); aiLy = true; note = '가사를 새로 썼어요. 아래에서 고쳐도 돼요.';
      }
    } catch (x) { note = x.message; }
    busy = false; draw(); const dt = box.querySelector('details'); if (dt) dt.open = true;
  }
  const box = document.createElement('div'); box.className = 'seq-modal';
  const draw = () => {
    const ch = diffDraft(base, cur, vocal), lyChanged = vocal && normLyrics(ly.v, ly.c, ly.b) !== ly0;
    const problem = vocal ? (lyricsProblem(ly.v, ly.c, ly.b) || narrProblem(narr)) : null;
    const ok = !busy && (ch.length || lyChanged) && !problem && (!vocal || consent);
    box.innerHTML = `<div class="seq-sheet ed-sheet">
      <div class="ed-head"><b class="sh-t">어떻게 고칠까요?</b><span class="ed-src">${esc(String(S.title || st.title || '').trim() || '이 곡')} · ${vocal ? '보컬곡' : '연주곡'}</span></div>
      <p class="st-note">말하듯 적어 주세요. 요청은 야르의 버튼 값으로만 바뀌어요 (가수 이름 · 기존 곡 흉내는 반영되지 않아요).</p>
      <div style="display:flex;gap:8px"><input class="st-in" id="eReq" maxlength="120" placeholder="${vocal ? '예: 더 신나게, 피아노 넣고, 남자 목소리로' : '예: 조금 더 잔잔하게, 기타로, 빈티지하게'}"><button class="btn" id="eApply" style="padding:10px 14px">적용</button></div>
      ${note ? `<p class="st-note" style="color:#FB923C;margin:6px 0 0">${busy ? '<span class="spin"></span> ' : ''}${esc(note)}</p>` : ''}
      ${vw ? `<div class="ed-vw"><p>🎤 연주곡에 가사 · 가수를 넣으려면 <b>보컬곡으로 새로 만들어야 해요</b> (하루 횟수 1번). 지금 고른 장르 · 빠르기 · 분위기 · 흐름은 그대로 가져가요${vw.g ? ` · ${vw.g === 'f' ? '여자' : '남자'} 목소리로 골라 둘게요` : ''}.</p><button class="btn" id="eVocal">이 레시피로 보컬곡 만들기 →</button></div>` : ''}
      ${sec ? `<div style="margin-top:8px;padding:12px;border-radius:12px;background:rgba(255,123,58,.13);border:1px solid rgba(255,123,58,.4)"><p class="st-note" style="margin:0 0 8px;color:#eee">'${secName(sec)}'만 바꾸고 싶다면 ✂ 구간 고치기가 좋아요. 이 창은 곡 전체를 새로 만들고, 구간 고치기는 그 부분만 다시 불러요 (앞뒤는 그대로).</p><button class="seq-key" id="eSec" ${busy ? 'disabled' : ''}>✂ ${secName(sec)}만 고치기 · 테이크 1개</button></div>` : ''}
      <div class="ed-grid">
        <div class="ed-groups">${QG.map(([g, ws]) => `<div class="ed-g"><span class="ed-gl">${g}</span><div class="chips">${ws.map((w) => {
          const [label, key] = Array.isArray(w) ? w : [w, null];
          if (key === '__spark') return `<button class="chip-b grp${cur.r.spark ? ' on' : ''}" data-q="${cur.r.spark ? '평범하게' : esc(label)}">${esc(label)}</button>`;
          if (key === '__vocal') return `<button class="chip-b grp ed-vq" data-vq="1">${esc(label)}</button>`;
          const V = { '남자 목소리로': () => cur.tone.startsWith('m_'), '여자 목소리로': () => cur.tone.startsWith('f_'), '걸그룹으로': () => cur.tone === 'group_girl', '합창으로': () => cur.tone === 'choir',
            '고음으로': () => cur.tune.range === 1, '더 감정 있게': () => cur.tune.emotion === 1, '허밍 넣어 줘': () => cur.adlib.includes('hum'), '추임새 넣어 줘': () => cur.adlib.includes('hype'), '랩 넣어 줘': () => cur.tune.rap === 1, '랩 빼 줘': () => cur.tune.rap === -1 };
          const on = g === '목소리' ? !!(V[label] && V[label]()) : key && (g === '악기' ? cur.r.lead === key : cur.r.genre === key);
          return `<button class="chip-b grp${on ? ' on' : ''}" data-q="${esc(label)}">${esc(label)}</button>`;
        }).join('')}</div></div>`).join('')}</div>
        ${recipePanel(base, cur, ch.length + (lyChanged ? 1 : 0), vocal)}
      </div>
      ${vocal ? `<details style="margin-top:12px" ${lyChanged ? 'open' : ''}><summary class="st-q" style="cursor:pointer">가사 · 나레이션도 고치기</summary>
        <div class="st-q">절 (Verse)</div><textarea class="st-ta" data-el="v" maxlength="400">${esc(ly.v)}</textarea>
        <div class="st-q">후렴 (Chorus)</div><textarea class="st-ta" data-el="c" maxlength="400">${esc(ly.c)}</textarea>
        <div class="st-q">브릿지 (Bridge) · 비워 두면 빼요</div><textarea class="st-ta" data-el="b" maxlength="400">${esc(ly.b)}</textarea>
        <div class="st-q">나레이션</div><div class="chips">${chips(NARR_POS, narr.pos, 'data-np')}</div>
        ${narr.pos !== 'none' ? `<div class="chips" style="margin-top:6px">${chips(NARR_TONE, narr.tone, 'data-nt')}</div><div class="chips" style="margin-top:6px">${chips(NARR_VOICE, narr.voice, 'data-nv')}</div><textarea class="st-ta" data-el="n" maxlength="80" style="min-height:56px;margin-top:8px">${esc(narr.text)}</textarea>` : ''}
      </details>
      ${problem ? `<p class="st-err st-note">${esc(errText(problem))}</p>` : ''}
      <label class="st-check"><input type="checkbox" id="eConsent" ${consent ? 'checked' : ''}><span><b>${aiLy ? '[필수] AI가 쓴 가사를 확인했고, 남의 노래 가사를 넣지 않았어요' : '[필수] 남의 가사를 베끼지 않고 직접 쓴 창작 가사예요'}</b></span></label>` : ''}
      <div class="sh-btns"><button class="btn sub" data-x>취소</button><button class="btn" id="eGo" ${ok ? '' : 'disabled'}>${ch.length || lyChanged ? `${ch.length + (lyChanged ? 1 : 0)}곳 고쳐서 만들기 · 추가 횟수 없음` : '위에서 고칠 곳을 골라 주세요'}</button></div>
    </div>`;
  };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (e.target === box || e.target.closest('[data-x]')) return box.remove();
    if (!b) return;
    if (b.dataset.vq) { vw = { g: null }; return draw(); }
    if (b.id === 'eVocal') { box.remove(); return toVocal(cur.r, vw && vw.g); }
    if (b.dataset.q || b.id === 'eApply') {
      const text = b.dataset.q || box.querySelector('#eReq').value;
      if (!vocal && /가사|노래|불러|부르|보컬|가수|목소리|여자|여성|남자|남성|랩|허밍/.test(text)) {
        vw = { g: /여자|여성|여가수/.test(text) ? 'f' : /남자|남성|남가수/.test(text) ? 'm' : null };
        cur = applyRequest(text, cur, vocal); return draw();
      }
      const la = vocal ? lyricRequest(text) : null;
      sec = vocal ? sectionRequest(text) : null; secStyle = sec ? sectionStyleRequest(text) : null;
      const next = applyRequest(text, cur, vocal);
      const changed = diffDraft(cur, next, vocal).length;
      cur = next;
      // '후렴 가사 바꿔 줘' → 후렴 줄만 · 그 밖의 가사 요청은 전체를 새로 (앱과 같아요)
      if (la && !busy) { lyricAsk(la === 'rewrite' && sec && lines(ly[keyOf[sec]]).length ? 'part' : la, text); return; }
      if (!changed && !sec) B.toast('알아들은 게 없어요. 예: 더 신나게, 랩 넣어 줘, 후렴부터 시작, 가사 다시 써 줘');
      return draw();
    }
    if (b.id === 'eSec') { // 구간 고치기로: 그 구간 · 분위기 · 새로 쓴 가사를 미리 골라 둔 채로 (2026-11-08)
      const t = st.takes.find((x) => x.status === 'READY') || t1;
      const blockText = ly[keyOf[sec]]; const orig = { v: sp.verse || '', c: sp.chorus || '', b: sp.bridge || '' }[keyOf[sec]];
      box.remove(); return openRepaint(t, { key: sec, style: secStyle, lines: lines(blockText).join('\n') !== lines(orig).join('\n') ? blockText : null });
    }
    if (b.id === 'eReset') { cur = { r: { ...base.r }, tone: base.tone, adlib: [...base.adlib], tune: { ...base.tune } }; return draw(); }
    if (b.dataset.np) { narr.pos = b.dataset.np; return draw(); }
    if (b.dataset.nt) { narr.tone = b.dataset.nt; return draw(); }
    if (b.dataset.nv) { narr.voice = b.dataset.nv; return draw(); }
    if (b.id === 'eGo') {
      const edit = { recipe: cur.r };
      if (vocal) Object.assign(edit, { vocal: cur.tone, adlib: cur.adlib, voiceTune: cur.tune, consent, lyrics: { verse: ly.v, chorus: ly.c, ...(ly.b.trim() ? { bridge: ly.b } : {}) }, ...(narr.pos !== 'none' ? { narration: narr } : {}) });
      box.remove(); return more(edit);
    }
  });
  box.addEventListener('input', (e) => { const t = e.target; if (t.dataset.el === 'n') narr.text = t.value; else if (t.dataset.el) ly[t.dataset.el] = t.value; });
  box.addEventListener('change', (e) => { const t = e.target; if (t.id === 'eConsent') consent = t.checked; if (t.dataset.el || t.id === 'eConsent') draw(); });
  box.addEventListener('keydown', (e) => { if (e.target.id === 'eReq' && e.key === 'Enter') box.querySelector('#eApply').click(); });
  draw(); document.body.appendChild(box);
}
