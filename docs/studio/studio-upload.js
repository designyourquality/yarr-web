// ⬆ 곡 올리기 · 📂 내 곡 (웹 스튜디오 · 앱 업로드 시트 + 검수 화면과 같은 규칙 · 2026-11-03)
//   become_creator → house-music/upload-url (1회용 주소) → 저장소에 바로 올리기 → tracks 등록 (검수 대기)
import { STATIONS, errText } from './studio-data.js?v=20261115';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } } };
const EXT = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/mp4', flac: 'audio/flac', ogg: 'audio/ogg' };
const TOOLS = { 'Suno v5': ['Pro', 'Premier', '무료 플랜'], 'ElevenLabs Music': ['Pro', 'Creator', 'Scale · Business (매장 재생 허용)', 'Starter', '무료 플랜'], 'Stable Audio 3.0': ['상업 라이선스', '무료 플랜'] };
const GENRES = ['팝', 'R&B/소울', '힙합', '시티팝', '재즈', '로파이', '어쿠스틱', '일렉트로닉/하우스', '록', '발라드', '트로트', '앰비언트', '클래식/피아노'];
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function guess(text) {
  const t = text.toLowerCase(), has = (w) => w.some((x) => t.includes(x));
  if (has(['gym', 'workout', 'cardio', 'house', 'edm', 'techno', '헬스', '운동'])) return ['#GYM_CARDIO', '일렉트로닉/하우스'];
  if (has(['lofi', 'lo-fi', 'chillhop', 'boom bap', '로파이'])) return [has(['study', '공부']) ? '#STUDY_CAFE' : '#RAINY_LOFI', '로파이'];
  if (has(['city pop', 'synthwave', 'drive', 'highway', '시티팝', '드라이브'])) return ['#NIGHT_DRIVE', '시티팝'];
  if (has(['bakery', 'morning', 'brunch', '아침', '베이커리'])) return ['#MORNING_BAKERY', has(['jazz', '재즈']) ? '재즈' : '어쿠스틱'];
  if (has(['lounge', 'r&b', 'neo-soul', 'soul', 'cocktail', '라운지'])) return ['#PUB_LOUNGE', 'R&B/소울'];
  if (has(['jazz', 'bossa', '재즈', '보사노바'])) return ['#WOOD_CAFE', '재즈'];
  if (has(['acoustic', 'cafe', 'guitar', '카페', '어쿠스틱'])) return ['#WOOD_CAFE', '어쿠스틱'];
  if (has(['focus', 'coding', 'ambient', '집중', '코딩'])) return ['#FOCUS_CODE', '앰비언트'];
  if (has(['study', 'piano', '공부', '피아노'])) return ['#STUDY_CAFE', '클래식/피아노'];
  if (has(['rain', '비'])) return ['#RAINY_LOFI', '로파이'];
  if (has(['hip hop', 'hip-hop', 'trap', 'rap', '힙합'])) return ['#NIGHT_DRIVE', '힙합'];
  if (has(['trot', '트로트'])) return ['#PUB_LOUNGE', '트로트'];
  if (has(['ballad', '발라드'])) return ['#WOOD_CAFE', '발라드'];
  if (has(['rock', '록'])) return ['#NIGHT_DRIVE', '록'];
  return ['#WOOD_CAFE', '팝'];
}

export function mountUpload(el, { sb, B, call, onDone }) {
  const F = { file: null, dur: null, url: null, title: '', tool: ls.get('upload_tool', 'Suno v5'), plan: ls.get('upload_plan', 'Pro'), prompt: '', lyrics: '', source: '',
    station: '#WOOD_CAFE', genre: '팝', guessed: false, inst: true, lyAi: false, notKomca: false, rights: false, busy: false, msg: '', step: '' };
  if (!TOOLS[F.tool]) F.tool = 'Suno v5';
  if (!TOOLS[F.tool].includes(F.plan)) F.plan = TOOLS[F.tool][0];
  let audio = null;
  const free = () => F.plan.includes('무료');
  const eleven = () => F.tool.includes('Eleven');
  const toolStoreOk = () => !eleven() || /^(scale|business)/i.test(F.plan);
  const storeOk = () => toolStoreOk() && (F.inst || (F.lyAi && F.notKomca));
  const planNote = () => free() ? ['st-err', '무료 플랜으로 만든 곡은 상업 이용이 안 돼서 YARR에 올릴 수 없어요.']
    : eleven() ? ['', toolStoreOk() ? 'ElevenLabs Scale · Business 플랜이라 차트 · 스테이션 · 매장 BGM 모두 갈 수 있어요.' : 'ElevenLabs 곡은 약관상 Scale · Business 플랜만 매장에 나갈 수 있어서, 이 곡은 차트 · 스테이션에만 등록돼요.']
      : ['', '유료 플랜이라 차트 · 스테이션에 올라가고, 연주곡이거나 가사도 AI가 만든 곡이면 매장 BGM 에도 들어가요.'];
  const storeNote = () => !toolStoreOk() ? 'ElevenLabs Pro · Creator 플랜 곡은 매장 공공장소 재생이 허용되지 않아 매장 BGM 풀에서 빠져요. 차트 · 스테이션에는 나가요.'
    : F.inst ? '연주곡은 매장 BGM 풀에도 들어가요.' : (F.lyAi && F.notKomca) ? '가사 있는 AI 곡으로 매장 BGM 풀에 들어가요. 가사 곡을 끈 매장에서는 빠져요.' : '가사도 AI가 만들었다고 확인해야 매장 BGM 풀에 들어가요. 확인하지 않으면 차트 · 스테이션에만 나가요.';

  function draw() {
    const step = !F.file ? 1 : !F.title.trim() ? 2 : 3;
    const [pc, pt] = planNote();
    el.innerHTML = `<div class="st-q drop-q">01 · 음원</div>
    <label class="drop big${F.file ? ' has' : ''}" id="uDrop"><input type="file" accept=".mp3,.wav,.m4a,.aac,.flac,.ogg,audio/*" id="uFile" hidden>
      <span class="drop-lp${F.file ? ' spin' : ''}" aria-hidden="true"><i>${F.file ? '♪' : '↑'}</i></span>
      ${F.file ? `<b>${esc(F.file.name)}</b><small>${(F.file.size / 1048576).toFixed(1)}MB · ${esc(F.file.name.split('.').pop().toUpperCase())}${F.dur ? ' · ' + fmt(F.dur) : ''}${F.dur && F.dur < 60 ? ' · ⚠ 60초 미만 (재생 집계 안 됨)' : ''} · 눌러서 바꾸기</small>` : '<b>음원 파일을 여기로 끌어다 놓으세요</b><small>또는 눌러서 고르기 · MP3 · WAV · M4A · FLAC · 50MB 이하 · 60초 이상</small>'}
      ${F.file ? `<button type="button" class="btn sub drop-prev" id="uPrev">${audio && !audio.paused ? '■ 멈춤' : '▶ 미리 듣기'}</button>` : ''}
    </label>
    <div class="st-grid">
      <div class="st-card">
        <div class="seq-row"><h3 style="flex:1">트랙 업로드</h3><span class="st-count">UPLOAD ${step}/3</span></div>
        <p class="st-note" style="margin-top:0">올리면 자동 검수를 거쳐 다음 0시에 공개돼요. 다른 곳(Suno · ElevenLabs · Stable Audio)에서 만든 곡을 올려 차트에 도전해요.</p>
        <div class="st-q">02 · 곡 정보</div>
        <input class="st-in" id="uTitle" maxlength="60" placeholder="곡 제목 · 예: 한강 노을 드라이브" value="${esc(F.title)}">
        ${/커버|cover|리메이크|remake/i.test(F.title) ? '<p class="st-note">커버 · 리메이크 표기가 있으면 운영팀이 원곡을 다시 부른 곡인지 확인해요. 다른 사람 곡을 다시 부른 곡은 올릴 수 없어요.</p>' : ''}
        ${F.title.includes('#') ? '<p class="st-note">제목에 # 태그가 있으면 운영팀 확인까지 오래 걸려요. 곡 이름만 적어 주세요.</p>' : ''}
        <div style="display:flex;gap:8px;margin-top:10px"><select class="st-in" id="uTool">${Object.keys(TOOLS).map((t) => `<option ${t === F.tool ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
          <select class="st-in" id="uPlan">${TOOLS[F.tool].map((p) => `<option ${p === F.plan ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div>
        <p class="st-note ${pc}">${esc(pt)}</p>
        <div class="st-q">프롬프트 레시피 (차트에 공개돼요)</div>
        <input class="st-in" id="uPrompt" placeholder="장르, 악기, 분위기, BPM" value="${esc(F.prompt)}">
        <details style="margin-top:10px"><summary class="st-q" style="cursor:pointer">선택 항목 · 가사 · 원본 생성 링크</summary>
          <div class="st-q">가사 (보컬 곡) <span class="r">다른 곡과 겹치는지 확인에만 써요 · 공개 안 됨</span></div><textarea class="st-ta" id="uLyrics" maxlength="6000">${esc(F.lyrics)}</textarea>
          <div class="st-q">원본 생성 링크 (권장) <span class="r">정산받을 때 직접 만든 곡이라는 증거가 돼요</span></div><input class="st-in" id="uSrc" placeholder="https://suno.com/song/…" value="${esc(F.source)}">
        </details>
      </div>
      <div class="st-card">
        <div class="st-q" style="margin-top:0">어울리는 스테이션</div>
        <div class="chips">${STATIONS.map((s) => `<button class="chip-b${s.code === F.station ? ' on' : ''}" data-st="${s.code}">${esc(s.tag)}</button>`).join('')}</div>
        <div class="st-q">장르</div><div class="chips">${GENRES.map((g) => `<button class="chip-b${g === F.genre ? ' on' : ''}" data-g="${esc(g)}">${esc(g)}</button>`).join('')}</div>
        <div class="st-q">매장 BGM 풀 (선택)</div>
        <div class="chips"><button class="chip-b${F.inst ? ' on' : ''}" data-inst="1">연주곡</button><button class="chip-b${F.inst ? '' : ' on'}" data-inst="0">가사 있는 곡</button></div>
        ${F.inst ? '' : `<label class="st-check"><input type="checkbox" id="uLyAi" ${F.lyAi ? 'checked' : ''}><span>가사도 AI가 만들었어요 (제가 직접 쓴 가사가 아니에요)</span></label>`}
        <p class="st-note">${esc(storeNote())}</p>
        <p class="st-note">사실과 다르게 확인하면 정산이 보류되고 곡이 내려갈 수 있어요.</p>
        <div class="st-q">03 · 확인</div>
        <label class="st-check"><input type="checkbox" id="uKomca" ${F.notKomca ? 'checked' : ''}><span><b>[필수] 이 곡은 음악 저작권 단체(음저협 등)에 등록하지 않았고, 저는 그 단체 회원이 아니에요</b><br><span class="st-note" style="margin:0">YARR 는 저작권 단체와 사용 계약이 없어서 등록된 곡은 차트 · 스테이션 · 매장에서 틀 수 없어요. 나중에 등록하려면 먼저 알려 주세요. 곡을 비공개로 돌려요.</span></span></label>
        <label class="st-check"><input type="checkbox" id="uRights" ${F.rights ? 'checked' : ''}><span><b>이 곡의 상업 이용 권리가 있고, 타인의 권리를 침해하지 않음을 확인합니다. 위반 시 정산이 보류돼요.</b></span></label>
        <button class="btn st-go" id="uGo" ${F.busy ? 'disabled' : ''}>${F.busy ? '<span class="spin"></span> ' + esc(F.step || '올리는 중…') : '검수 시작 · 올리기'}</button>
        <p class="st-note ${F.msg.startsWith('✓') ? '' : 'st-err'}" id="uMsg">${esc(F.msg)}</p>
        <p class="st-note">음량 맞춤 · 기존 곡 대조 · 최종 판정은 올린 뒤 서버 검수에서 해요. 기존 곡으로 확인되면 반려되고 공개되지 않아요.</p>
      </div></div>`;
  }
  function setFile(f) {
    if (!f) return;
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!EXT[ext]) { F.msg = `${f.name}: 지원하지 않는 형식이에요. MP3, WAV, M4A, AAC, FLAC, OGG 파일을 골라 주세요.`; return draw(); }
    if (f.size > 50 * 1048576) { F.msg = `${f.name}: 50MB 이하 파일만 올릴 수 있어요. (지금 ${(f.size / 1048576).toFixed(1)}MB)`; return draw(); }
    F.file = f; F.dur = null; F.msg = '';
    if (F.url) URL.revokeObjectURL(F.url); F.url = URL.createObjectURL(f);
    if (!F.title.trim()) F.title = f.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/\s*\(\d+\)$/, '').replace(/-v\d+$/i, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!F.guessed) { [F.station, F.genre] = guess(`${F.title} ${F.prompt}`); }
    const a = new Audio(); a.preload = 'metadata'; a.src = F.url;
    a.onloadedmetadata = () => { if (isFinite(a.duration)) { F.dur = a.duration; draw(); } };
    draw();
  }
  el.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.st) { F.station = b.dataset.st; F.guessed = true; return draw(); }
    if (b.dataset.g) { F.genre = b.dataset.g; F.guessed = true; return draw(); }
    if (b.dataset.inst) { F.inst = b.dataset.inst === '1'; return draw(); }
    if (b.id === 'uPrev') { e.preventDefault(); if (audio && !audio.paused) audio.pause(); else { B.pauseMain(); audio = audio || new Audio(F.url); if (audio.src !== F.url) audio.src = F.url; audio.play(); audio.onended = draw; } return draw(); }
    if (b.id === 'uGo') return submit();
  };
  el.oninput = (e) => {
    const t = e.target;
    if (t.id === 'uTitle') F.title = t.value; if (t.id === 'uPrompt') F.prompt = t.value; if (t.id === 'uLyrics') F.lyrics = t.value; if (t.id === 'uSrc') F.source = t.value;
  };
  el.onchange = (e) => {
    const t = e.target;
    if (t.id === 'uFile') return setFile(t.files?.[0]);
    if (t.id === 'uTool') { F.tool = t.value; F.plan = TOOLS[F.tool][0]; ls.set('upload_tool', F.tool); ls.set('upload_plan', F.plan); }
    if (t.id === 'uPlan') { F.plan = t.value; ls.set('upload_plan', F.plan); }
    if (t.id === 'uLyAi') F.lyAi = t.checked; if (t.id === 'uKomca') F.notKomca = t.checked; if (t.id === 'uRights') F.rights = t.checked;
    if (['uTitle', 'uPrompt', 'uTool', 'uPlan', 'uLyAi', 'uKomca'].includes(t.id)) draw();
  };
  el.ondragover = (e) => { e.preventDefault(); el.querySelector('#uDrop')?.classList.add('over'); };
  el.ondragleave = () => el.querySelector('#uDrop')?.classList.remove('over');
  el.ondrop = (e) => { e.preventDefault(); el.querySelector('#uDrop')?.classList.remove('over'); setFile(e.dataTransfer.files?.[0]); };

  async function submit() {
    const fail = (m) => { F.msg = m; F.busy = false; draw(); };
    if (!F.title.trim()) return fail('곡 제목을 입력하세요.');
    if (free()) return fail('무료 플랜으로 만든 곡은 상업 이용 권리가 없어서 올릴 수 없어요. 유료 플랜에서 만든 곡을 올려 주세요.');
    if (F.source.trim() && !/^https?:\/\//i.test(F.source.trim())) return fail('원본 생성 링크는 https:// 로 시작하는 주소여야 해요.');
    if (F.dur != null && F.dur < 60) return fail(`${Math.round(F.dur)}초짜리 곡이에요. 60초 이상 들어야 재생이 집계돼서 60초보다 짧은 곡은 올릴 수 없어요.`);
    if (!F.file) return fail('음원 파일을 골라 주세요.');
    if (!F.notKomca) return fail('[필수] 저작권 단체 미등록 확인에 체크해야 올릴 수 있어요.');
    if (!F.rights) return fail('권리 확인에 체크해야 업로드할 수 있어요.');
    if (F.tool.includes('Eleven') && F.plan === 'Starter') return fail('ElevenLabs Starter 플랜은 스트리밍 배포가 허용되지 않아요. 배포 허용 플랜이 필요해요.');
    F.busy = true; F.msg = ''; F.step = '음원 파일 올리는 중…'; draw();
    try {
      await sb.rpc('become_creator');
      const ext = F.file.name.split('.').pop().toLowerCase();
      let tk;
      try { tk = await call('upload-url', { ext, size: F.file.size }, 15000); }
      catch (x) { return fail(x.code === 'LOGIN_REQUIRED' ? '로그인이 풀렸어요. 다시 로그인해 주세요.' : x.code ? errText(x.code) : '업로드 준비에 실패했어요. 잠시 뒤 다시 시도해 주세요.'); }
      const up = await sb.storage.from('uploads').uploadToSignedUrl(tk.path, tk.token, F.file, { contentType: EXT[ext], upsert: false });
      if (up.error) return fail(`음원 파일을 올리지 못했어요: ${up.error.message}`);
      F.step = '곡 정보 등록 중…'; draw();
      const tool = F.tool.toLowerCase();
      const row = {
        title: F.title.trim(), ai_engine: tool.includes('suno') ? 'SUNO_PRO' : tool.includes('eleven') ? 'ELEVENLABS' : tool.includes('stable') ? 'STABLE_AUDIO_3' : 'HYBRID_HUMAN',
        ai_plan: F.plan, prompt_recipe: F.prompt.trim() || '(프롬프트 미입력)', genre: F.genre, bpm: 110, is_instrumental: F.inst, situation_tags: [F.station], is_human_hybrid: false,
        ...(F.lyrics.trim() ? { lyrics: F.lyrics.trim() } : {}), ...(F.source.trim() ? { source_url: F.source.trim() } : {}),
        ...(!F.inst && F.lyAi ? { lyrics_ai_generated: true } : {}), ...(F.notKomca ? { creator_not_komca: true } : {}),
        original_url: tk.ref,
      };
      const ins = await sb.from('tracks').insert(row);
      if (ins.error) {
        const m = ins.error.message || '';
        if (m.includes('UPLOAD_SUSPENDED')) return fail(`최근 90일 동안 권리 문제로 3번 반려돼 ${(m.match(/\d{4}-\d{2}-\d{2}/) || [''])[0]}까지 업로드가 멈춰 있어요. 반려 이유는 '내 곡'에서 볼 수 있어요.`);
        if (m.includes('DAILY_UPLOAD_LIMIT')) { const lim = await sb.rpc('my_entitlements').then((r) => r.data?.[0]?.upload_limit ?? 5, () => 5); return fail(`오늘 올릴 수 있는 곡 수(${lim}곡)를 다 썼어요. 내일(한국 시간 0시 이후) 다시 올려 주세요.`); }
        return fail(`올리지 못했어요: ${m}`);
      }
      B.toast(`'${row.title}' 올렸어요 · 검수를 통과하면 다음 0시에 공개돼요`);
      const keep = { tool: F.tool, plan: F.plan };
      Object.assign(F, { file: null, dur: null, title: '', prompt: '', lyrics: '', source: '', rights: false, busy: false, guessed: false, lyAi: false, notKomca: false, msg: '✓ 올렸어요 · 검수 대기 → 통과하면 다음 0시 공개 (내 곡에서 확인)' }, keep);
      onDone?.(); draw();
    } catch (x) { fail(`올리지 못했어요: ${x.message || x}`); }
  }
  draw();
}

// ---------- 📁 내 곡 (2026-11-04 · 다시 그림) ----------
// 상태 한눈에 (요약 타일 · 필터) · 곡마다 커버 · 파형 · 재생 수 · 검수 진행 단계 · 공개 중인 곡은 바로 듣기
export const ICONS = {
  make: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
  mine: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="10.5" cy="15.5" r="1.8"/><path d="M12.3 15.5V10.5l3.2-.8"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h3v14H8zM13 5h3v14h-3z" fill="currentColor" stroke="none"/></svg>',
  headphones: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/></svg>',
};
const STEPS = ['업로드', '자동 검수', '운영팀 확인', '공개'];
// ✔ 창작 음원 이용 확인서 (앱 use_certificate_screen.dart 와 같은 내용 · 2026-11-08 · Pro · YARR 스튜디오 곡만)
const CERT_ERR = { CERT_STUDIO_ONLY: '이용 확인서는 YARR 스튜디오에서 만든 곡만 받을 수 있어요.', PRO_ONLY: '이용 확인서는 크리에이터 Pro 기능이에요.', NOT_READY: '공개 중인 곡만 확인서를 받을 수 있어요.', NOT_FOUND: '곡을 찾지 못했어요.', LOGIN_REQUIRED: '로그인이 풀렸어요. 다시 로그인해 주세요.' };
async function showCert(id) {
  const sbx = mineCtx.sb, B = mineCtx.B;
  const { data, error } = await sbx.functions.invoke('house-music/make-download', { body: { track_id: id, cert: true } }).catch((x) => ({ error: x }));
  let code = data?.error || null;
  if (error) { try { const j = await error.context?.json?.(); code = j?.error || j?.code || code; } catch { /* 본문 없음 */ } }
  const c = data?.cert;
  if (!c) return B?.toast?.(CERT_ERR[code] || '확인서를 만들지 못했어요');
  const day = (v) => v ? new Date(v).toLocaleDateString('ko-KR') : '-';
  const line = `음악: "${c.title}" · YARR 스튜디오에서 AI로 만든 곡 (확인서 ${c.no} · yarrmusic.com)`;
  const row = (k, v) => `<div style="display:flex;gap:12px;padding:7px 0;border-bottom:1px solid #e6dfd6"><b style="width:92px;flex:none;color:#6b5f52;font-size:12.5px">${esc(k)}</b><span style="color:#1e1a16;font-size:13px;line-height:1.5">${esc(v)}</span></div>`;
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
  wrap.innerHTML = `<div style="background:#fbf7f1;border-radius:16px;max-width:520px;width:100%;padding:22px 20px;box-shadow:0 20px 60px rgba(0,0,0,.5)">
    <div style="text-align:center;font-size:19px;font-weight:900;color:#1e1a16">창작 음원 이용 확인서</div>
    <div style="text-align:center;font-size:12px;color:#8a7d70;margin:4px 0 12px">${esc(c.no)}</div>
    ${row('곡 제목', c.title)}${row('만든 곳', `YARR 스튜디오 (${String(c.engine || '').replace('YARR 스튜디오 · ', '')})`)}${row('만든 날 · 공개', `${day(c.made_at)} · ${day(c.published_at)}`)}
    ${row('AI 생성', '예 · 음원은 AI로 만들었고 파일 정보에 AI 표시가 들어 있어요')}${row('가사', c.lyrics === 'human' ? '만든 사람이 직접 씀' : c.lyrics === 'ai' ? 'AI가 씀' : '연주곡')}
    ${c.human_touch ? row('사람 참여', '작사 · 구간 다듬기 등 사람이 손본 기록이 있어요') : ''}
    ${row('신탁단체', c.self_declared_not_registered ? '만든 사람이 올릴 때 "음악 저작권 단체에 등록하지 않았고 회원이 아니다"라고 직접 확인했어요' : '올릴 때 확인 기록이 없어요')}
    ${row('쓸 수 있는 곳', '만든 사람 본인의 영상 · SNS 게시물 · 영화제 출품작 배경음악 (음원 자체 판매 · 음원 사이트 유통 · 광고 사용은 안 돼요)')}${row('발급일', day(c.issued_at))}
    <p style="font-size:11.5px;color:#8a7d70;line-height:1.5;margin:12px 0">이 확인서는 YARR가 가진 기록을 사실대로 적은 것이에요. 저작권을 보장하거나 다른 곡과 비슷하지 않다는 것을 보증하지 않아요. 발급: ${esc(day(c.issued_at))} (${esc(c.no)})</p>
    <div style="font-size:13px;font-weight:800;color:#1e1a16;margin-bottom:6px">영상 설명란에 붙여 넣기</div>
    <div style="background:#efe7dc;border-radius:10px;padding:10px;font-size:12.5px;color:#1e1a16">${esc(line)}</div>
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn" data-cc="1" style="flex:1">한 줄 복사</button><button class="btn sub" data-cx="1" style="flex:1">닫기</button></div>
    <p style="font-size:11.5px;color:#8a7d70;margin:10px 0 0">화면을 캡처해 두거나, 문의가 오면 확인서 번호를 알려 주세요.</p></div>`;
  wrap.onclick = async (e) => {
    if (e.target === wrap || e.target.closest('[data-cx]')) return wrap.remove();
    if (e.target.closest('[data-cc]')) { try { await navigator.clipboard.writeText(line); B?.toast?.('복사했어요'); } catch { window.prompt('아래 줄을 복사해 주세요', line); } }
  };
  document.body.appendChild(wrap);
}
const mineCtx = {};

export async function mountMine(el, { sb, user, B, onTranslate, onGo }) {
  Object.assign(mineCtx, { sb, B });
  el.innerHTML = '<div class="st-card mine"><span class="spin"></span> 내 곡을 불러오는 중…</div>';
  const q = (cols) => sb.from('tracks').select(cols).eq('creator_id', user.id).order('created_at', { ascending: false }).limit(40);
  let { data, error } = await q('id,title,status,created_at,publish_at,reject_reason,genre,is_instrumental,ai_plan,duration_sec,bpm,play_count_total,situation_tags,waveform,audio_url');
  if (error) ({ data, error } = await q('id,title,status,created_at,publish_at,reject_reason,genre,is_instrumental,ai_plan')); // 칸 권한이 바뀌어도 목록은 보여요
  if (error) { el.innerHTML = '<div class="st-card"><p class="st-note st-err">내 곡을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p></div>'; return; }
  const now = Date.now();
  const kind = (t) => t.status === 'PENDING' ? 'wait' : t.status === 'ACTIVE' ? (t.publish_at && new Date(t.publish_at) > now ? 'soon' : 'live') : t.status === 'REJECTED' ? 'bad' : 'off';
  const LABEL = { live: '공개 중', soon: '공개 예정', wait: '검수 중', bad: '반려', off: '내려감' };
  // 086 (2026-11-09): 반려 곡 · 누구 책임인지 · 경고 · 돌려준 횟수 · 숨김 (086 전이면 비어 있어요 → 예전처럼)
  const rej = {};
  try {
    const { data: rr, error: re } = await sb.rpc('my_reject_info');
    if (!re) for (const x of rr || []) rej[x.id] = x;
  } catch { /* 086 전 */ }
  // 087 (2026-11-09): 곡마다 매장 몇 곳에서 몇 번 흘렀는지 (매장 이름 · 위치는 안 알려 줘요 · 087 전이면 비어 있어요)
  const sp = {};
  try {
    const { data: pp, error: pe } = await sb.rpc('my_track_store_plays');
    if (!pe) for (const x of pp || []) sp[x.track_id] = x;
  } catch { /* 087 전 */ }
  let rows = data.filter((t) => !rej[t.id]?.hidden).map((t) => ({ ...t, k: kind(t), rj: rej[t.id] || null }));
  // ⚡ 레시피 공개 (071 SQL · 내 곡마다 켜고 끄기 · 071 전이면 스위치를 안 보여요)
  const flags = {};
  try {
    const { data: fl, error: fe } = await sb.rpc('my_recipe_flags');
    if (!fe) for (const f of fl || []) flags[f.id] = { on: f.recipe_public === true, studio: f.studio === true, lang: f.lang || null };
  } catch { /* 071 전 */ }
  const count = (k) => rows.filter((r) => r.k === k).length;
  const plays = rows.reduce((a, r) => a + Number(r.play_count_total || 0), 0);
  let filter = 'all', audio = null, playing = null;
  const fmtDur = (s) => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '';
  const num = (n) => Number(n || 0).toLocaleString('ko-KR');
  const stName = (t) => (t.situation_tags || []).map((c) => STATIONS.find((s) => s[0] === c)?.[1]).find(Boolean) || '';
  const cover = (t) => (B?.coverCss ? B.coverCss({ id: t.id, tags: t.situation_tags || [], genre: t.genre }) : 'background:linear-gradient(135deg,#FF8C00,#3a1d08)');
  // 파형 (0.1초 단위 0~100) → 막대 48개
  const wave = (w) => {
    const N = 96; const src = Array.isArray(w) && w.length ? w : null;
    const bars = Array.from({ length: N }, (_, i) => {
      if (!src) return 18 + 14 * Math.abs(Math.sin(i * 1.7)) ;
      const a = Math.floor(i * src.length / N), b = Math.max(a + 1, Math.floor((i + 1) * src.length / N));
      let m = 0; for (let j = a; j < b; j++) m = Math.max(m, src[j] || 0); return Math.max(8, m);
    });
    return `<svg class="mi-wave${src ? '' : ' ghost'}" viewBox="0 0 ${N * 4} 40" preserveAspectRatio="none" aria-hidden="true">${bars.map((v, i) => `<rect x="${i * 4}" y="${(40 - v * 0.4) / 2}" width="2.2" height="${v * 0.4}" rx="1.2"/>`).join('')}</svg>`;
  };
  const steps = (t) => {
    const at = t.k === 'wait' ? 1 : t.k === 'soon' ? 3 : 4;
    return `<div class="mi-steps">${STEPS.map((s, i) => `<span class="${i < at ? 'done' : i === at ? 'now' : ''}">${s}</span>`).join('<i></i>')}</div>`;
  };
  const sub = (t) => t.k === 'wait' ? steps(t)
    : t.k === 'soon' ? `<p class="mi-msg">${new Date(t.publish_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}에 공개돼요</p>`
    : t.k === 'bad' ? `<p class="mi-msg bad">${esc(t.reject_reason || '반려됐어요')}</p>${rejectNote(t)}
      <div class="mi-emb"><button class="mi-trb" data-again="${t.id}">${t.rj?.studio ? '다시 만들기' : '고쳐서 다시 올리기'}</button><button class="mi-trb" data-hide="${t.id}">목록에서 숨기기</button></div>`
    : t.k === 'live' ? `<p class="mi-msg">차트 · 스테이션에 나가요</p>` : '';
  // 앱 MyServerTrack.rejectNote 와 같아요
  const rejectNote = (t) => {
    const r = t.rj; let msg, cls = '';
    if (t.reject_reason === '본인 요청 · 새 버전으로 교체') msg = '본인 요청으로 새 버전으로 바꿨어요';
    else if (r?.fault === 'yarr') { msg = r.refunded ? 'AI가 만든 결과물 문제라 회원님 잘못이 아니에요 · 경고 없음 · 쓴 횟수 1번을 돌려드렸어요' : 'AI가 만든 결과물 문제라 회원님 잘못이 아니에요 · 경고 없음'; cls = ' ok'; }
    else if (r?.fault === 'user' && r.strike) { msg = '권리 문제 반려 · 경고 1회 (90일 동안 · 3번이면 30일 동안 올리기 제한)'; cls = ' bad'; }
    else msg = r?.studio ? '다시 만들어 볼 수 있어요' : '고쳐서 다시 올릴 수 있어요';
    return `<p class="mi-msg${cls}"${cls === ' ok' ? ' style="color:#6EE7A0"' : ''}>${esc(msg)}</p>`;
  };
  // 앱 TrackStorePlays.line · 공유 문구와 같아요
  const storeLine = (t) => {
    const x = sp[t.id]; if (t.k !== 'live' || !x || !(x.total_plays > 0)) return '';
    const msg = x.week_plays > 0 ? `이번 주 매장 ${x.week_stores}곳에서 ${x.week_plays}번 흘렀어요 · 지금까지 ${x.total_stores}곳` : `지금까지 매장 ${x.total_stores}곳에서 ${x.total_plays}번 흘렀어요`;
    return `<div class="mi-emb"><p class="mi-msg" style="color:#FFB020;font-weight:700;margin:0">🏪 ${esc(msg)}</p><button class="mi-trb" data-brag="${t.id}">자랑하기</button></div>`;
  };
  const bragText = (t) => {
    const x = sp[t.id], week = x.week_plays > 0, url = `${location.origin}/listen.html`;
    return week ? `제 AI 곡 '${t.title}'이 이번 주 매장 ${x.week_stores}곳에서 ${x.week_plays}번 흘렀어요! 🎧 들어 보세요 👉 ${url}`
      : `제 AI 곡 '${t.title}'이 지금까지 매장 ${x.total_stores}곳에서 ${x.total_plays}번 흘렀어요! 🎧 들어 보세요 👉 ${url}`;
  };
  const card = (t) => {
    const canPlay = t.k === 'live' && String(t.audio_url || '').startsWith('storage:uploads/');
    const meta = ['🤖 AI', t.genre, t.is_instrumental ? '연주곡' : '보컬곡', t.bpm ? `${t.bpm} BPM` : '', fmtDur(t.duration_sec), stName(t)].filter(Boolean).map(esc).join(' · ');
    return `<article class="mi ${t.k}${playing === t.id ? ' playing' : ''}" data-id="${t.id}">
      <div class="mi-cover" style="${cover(t)}">${canPlay ? `<button class="mi-play" data-play="${t.id}" aria-label="${esc(t.title)} 듣기">${playing === t.id && audio && !audio.paused ? ICONS.pause : ICONS.play}</button>` : ''}</div>
      <div class="mi-body">
        <div class="mi-top"><b class="mi-title">${esc(t.title)}</b><span class="mi-pill ${t.k}"><i></i>${LABEL[t.k]}</span></div>
        <div class="mi-meta">${meta}<span class="mi-date">${new Date(t.created_at).toLocaleDateString('ko-KR')}</span></div>
        <div class="mi-row">${wave(t.waveform)}${t.k === 'live' ? `<span class="mi-plays" title="유효 재생 수">${ICONS.headphones}${num(t.play_count_total)}</span>` : ''}</div>
        ${sub(t)}
        ${storeLine(t)}
        ${recipe(t)}
        ${trans(t)}
        ${t.k === 'live' && String(t.ai_plan || '').startsWith('YARR 스튜디오') ? `<div class="mi-emb"><button class="mi-trb" data-cert="${t.id}">✔ 창작 음원 이용 확인서</button><em>영상 · SNS 배경음악으로 쓸 때 보여 줄 수 있는 기록 (Pro)</em></div>` : ''}
        ${t.k === 'live' ? `<div class="mi-emb"><button class="mi-trb" data-emb="${t.id}">&lt;/&gt; 위젯 코드 복사</button><em>블로그 · 노션 · 사이트에 넣는 미니 플레이어 (15초 미리듣기 · 전체 듣기 · ⚡ 변주하기)</em></div>` : ''}
      </div>
    </article>`;
  };
  // 레시피 공개 스위치: 스튜디오 곡은 세팅(변주) · 올린 곡은 곡 설명 원문 · 내려간 곡은 안 보여요
  const recipe = (t) => {
    const f = flags[t.id]; if (!f || t.k === 'off' || t.k === 'bad') return '';
    const what = f.studio ? '다른 사람이 이 곡 세팅(장르 · 노브 · 목소리 · 멜로디)으로 변주할 수 있어요 · 가사 · 곡 설명 원문은 안 나가요'
      : '곡 설명(프롬프트) 원문이 차트에 보이고, 다른 사람이 이 곡을 원곡으로 변주할 수 있어요';
    return `<div class="mi-recipe"><button class="mi-sw${f.on ? ' on' : ''}" data-recipe="${t.id}" role="switch" aria-checked="${f.on}" ${f.busy ? 'disabled' : ''}><i></i>⚡ 레시피 공개 ${f.on ? '켜짐' : '꺼짐'}</button><span>${what}${f.on ? ' · 변주곡 수익의 30%가 나에게 와요' : ''}</span></div>`;
  };
  // 🌐 다른 언어로 (072 SQL · 공개 중인 내 보컬곡만 · 지금 언어는 빼고)
  const LANGS = [['en', '🇺🇸 English'], ['ja', '🇯🇵 日本語'], ['ko', '🇰🇷 한국어']];
  const trans = (t) => {
    const f = flags[t.id]; if (!onTranslate || !f?.lang || t.is_instrumental || t.k !== 'live') return '';
    return `<div class="mi-tr"><span>🌐 다른 언어로 부르기</span>${LANGS.filter(([k]) => k !== f.lang).map(([k, n]) => `<button class="mi-trb" data-tr="${t.id}" data-tl="${k}">${n}</button>`).join('')}<em>같은 레시피 · 목소리로, 가사는 음절을 맞춰 개사해요</em></div>`;
  };
  const tile = (k, label, n, extra = '') => `<button class="mi-tile ${k}${filter === k ? ' on' : ''}" data-f="${k}"><span>${label}</span><b>${n}</b>${extra}</button>`;
  const draw = () => {
    const list = rows.filter((r) => filter === 'all' || r.k === filter || (filter === 'live' && r.k === 'soon'));
    el.innerHTML = `<div class="st-card mine">
      <div class="mi-head"><span class="mi-ic">${ICONS.mine}</span><div><h3>내 곡</h3><p class="st-note" style="margin:0">만든 곡 · 올린 곡의 검수 상태와 재생 수를 모아 봐요</p></div></div>
      <div class="mi-tiles">
        ${tile('all', '전체', rows.length)}${tile('live', '공개 중', count('live') + count('soon'))}${tile('wait', '검수 중', count('wait'))}${tile('bad', '반려', count('bad'))}
        <div class="mi-tile total"><span>누적 재생</span><b>${num(plays)}</b></div>
      </div>
      ${list.length ? `<div class="mi-list">${list.map(card).join('')}</div>`
        : rows.length ? '<p class="mi-empty">이 상태의 곡이 없어요.</p>'
        : `<div class="mi-empty big"><span class="mi-ic">${ICONS.mine}</span><b>아직 곡이 없어요</b><p>곡 만들기나 곡 올리기에서 첫 곡을 올려 보세요.</p></div>`}
    </div>`;
  };
  draw();
  el.onclick = async (e) => {
    const f = e.target.closest('[data-f]'); if (f) { filter = f.dataset.f; return draw(); }
    const em = e.target.closest('[data-emb]');
    if (em) {
      const row = rows.find((r) => r.id === em.dataset.emb);
      const code = `<iframe src="https://yarrmusic.com/embed.html?song_id=${em.dataset.emb}" width="100%" height="152" style="border:0;border-radius:14px;max-width:560px" allow="autoplay" loading="lazy" title="YARR · ${esc(row?.title || '플레이어')}"></iframe>`;
      try { await navigator.clipboard.writeText(code); B?.toast?.('위젯 코드를 복사했어요 · 블로그 · 노션 · 사이트의 HTML 넣기에 붙여 넣어 주세요'); }
      catch { window.prompt('아래 코드를 복사해 주세요', code); }
      return;
    }
    const bg = e.target.closest('[data-brag]');
    if (bg) {
      const t = rows.find((r) => r.id === bg.dataset.brag); if (!t) return;
      const text = bragText(t);
      try { if (navigator.share) { await navigator.share({ text }); return; } } catch { return; }
      try { await navigator.clipboard.writeText(text); B?.toast?.('자랑 문구를 복사했어요 · 카톡 · SNS에 붙여 넣어 보세요'); } catch { window.prompt('이 문구를 복사해 주세요', text); }
      return;
    }
    const ag = e.target.closest('[data-again]');
    if (ag) { const t = rows.find((r) => r.id === ag.dataset.again); return onGo?.(t?.rj?.studio ? 'make' : 'upload'); }
    const hd = e.target.closest('[data-hide]');
    if (hd) {
      const t = rows.find((r) => r.id === hd.dataset.hide);
      if (!t || !window.confirm(`'${t.title}' 숨길까요?\n내 곡 목록에서만 안 보여요. 검수 기록은 남고, 경고가 있었다면 그대로 세요.`)) return;
      hd.disabled = true;
      const { data: ok, error: er } = await sb.rpc('hide_my_rejected', { p_track: t.id }).catch((x) => ({ error: x }));
      if (er || ok !== true) { hd.disabled = false; return B?.toast?.('숨기지 못했어요 · 잠시 뒤 다시 해 주세요'); }
      rows = rows.filter((r) => r.id !== t.id); draw(); return B?.toast?.('목록에서 숨겼어요');
    }
    const ce = e.target.closest('[data-cert]');
    if (ce) { ce.disabled = true; try { await showCert(ce.dataset.cert); } finally { ce.disabled = false; } return; }
    const tr = e.target.closest('[data-tr]');
    if (tr) { tr.disabled = true; try { await onTranslate(tr.dataset.tr, tr.dataset.tl); } finally { tr.disabled = false; } return; }
    const sw = e.target.closest('[data-recipe]');
    if (sw) {
      const fl = flags[sw.dataset.recipe]; if (!fl || fl.busy) return;
      const want = !fl.on; fl.busy = true; draw();
      const { data: ok, error: er } = await sb.rpc('set_recipe_public', { p_track: sw.dataset.recipe, p_on: want }).catch((x) => ({ error: x }));
      fl.busy = false;
      if (er || ok !== true) { draw(); return B?.toast?.('바꾸지 못했어요 · 잠시 뒤 다시 해 주세요'); }
      fl.on = want; draw();
      return B?.toast?.(want ? '레시피를 공개했어요' : '레시피를 비공개로 바꿨어요');
    }
    const p = e.target.closest('[data-play]'); if (!p) return;
    const t = rows.find((r) => r.id === p.dataset.play); if (!t) return;
    if (playing === t.id && audio && !audio.paused) { audio.pause(); return draw(); }
    if (playing === t.id && audio) { B?.pauseMain?.(); audio.play(); return draw(); }
    const path = t.audio_url.slice('storage:uploads/'.length);
    p.disabled = true;
    const { data: d } = await sb.functions.invoke('house-music/audio-urls', { body: { paths: [path] } }).catch(() => ({ data: null }));
    const url = d?.urls?.[path];
    if (!url) { p.disabled = false; return B?.toast?.('이 곡을 불러오지 못했어요'); }
    B?.pauseMain?.(); if (audio) audio.pause();
    audio = new Audio(url); playing = t.id; audio.onended = () => { playing = null; draw(); };
    audio.play().catch(() => B?.toast?.('재생하지 못했어요')); draw();
  };
}
