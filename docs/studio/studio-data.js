// 웹 스튜디오 데이터 (앱 studio_recipe.dart · studio_edit.dart · backend.dart 와 같은 값 · 2026-11-03 · 공간 24곳 · 목소리 36종 2026-11-08)
export const STATIONS = [
  ['#NIGHT_DRIVE', '#야간드라이브', 104, '시티팝', '밤 · 드라이브'], ['#WOOD_CAFE', '#우드톤카페', 70, '앰비언트', '오후'],
  ['#RAINY_LOFI', '#비오는날', 72, '로파이', '비 오는 날'], ['#FOCUS_CODE', '#코딩집중', 80, '앰비언트', '낮 업무 시간'],
  ['#GYM_CARDIO', '#헬스장유산소', 126, '하우스', '운동 시간'], ['#STUDY_CAFE', '#스터디카페', 76, '로파이', '오후 · 저녁'],
  ['#PUB_LOUNGE', '#펍/라운지', 96, '시티팝', '저녁 · 밤'], ['#MORNING_BAKERY', '#모닝베이커리', 84, '앰비언트', '아침'],
  ['#WINE_BAR', '#와인/다이닝바', 88, '재즈', '저녁 · 디너'], ['#BOUTIQUE', '#힙한편집샵', 115, '하우스', '오후 · 쇼핑'],
  ['#SPA_YOGA', '#힐링요가/스파', 68, '앰비언트', '아침 · 오후'], ['#ROOFTOP', '#루프탑/선셋', 102, '하우스', '해 질 녘'],
  ['#DAWN_MOOD', '#새벽감성', 76, '피아노', '새벽'], ['#HANGANG_PICNIC', '#한강피크닉', 106, '어쿠스틱', '주말 오후'],
  ['#SUMMER_BEACH', '#여름바다', 120, '레게 · 트로피컬', '여름 · 낮'], ['#POCHA_NIGHT', '#포차/퇴근길', 95, '트로트', '퇴근 후 · 밤'],
  // 2026-11-08 매장 업종 8곳 (앱 catalog.dart · 084 SQL 과 같아요)
  ['#SALON_NAIL', '#미용실/네일', 98, 'R&B · 팝', '오후 · 예약 시간'], ['#CLINIC_WAIT', '#병원대기실', 68, '피아노', '진료 시간'],
  ['#BOOK_CAFE', '#북카페/서점', 78, '어쿠스틱', '오후'], ['#HOTEL_LOBBY', '#호텔로비', 88, '재즈 · 보사노바', '하루 종일'],
  ['#BRUNCH_CAFE', '#브런치카페', 102, '어쿠스틱 팝', '오전 · 주말'], ['#FLOWER_SHOP', '#꽃집/플라워', 86, '어쿠스틱', '오후'],
  ['#GOLF_RANGE', '#골프연습장', 112, '하우스 · 펑크', '저녁'], ['#CAMPING', '#캠핑/글램핑', 84, '포크 · 어쿠스틱', '밤 · 주말'],
].map(([code, tag, bpm, ko, slot]) => ({ code, tag, bpm, ko, slot }));
export const ST = Object.fromEntries(STATIONS.map((s) => [s.code, s]));
/** 공간 묶음 (앱 stationGroups 와 같아요 · 2026-11-08) */
export const STATION_GROUPS = [
  ['☕ 카페', ['#WOOD_CAFE', '#MORNING_BAKERY', '#BRUNCH_CAFE', '#BOOK_CAFE', '#STUDY_CAFE']],
  ['🛍️ 숍 · 뷰티', ['#BOUTIQUE', '#SALON_NAIL', '#FLOWER_SHOP', '#HOTEL_LOBBY']],
  ['🧘 집중 · 휴식', ['#FOCUS_CODE', '#CLINIC_WAIT', '#SPA_YOGA', '#DAWN_MOOD']],
  ['🍷 밤 · 술', ['#PUB_LOUNGE', '#WINE_BAR', '#POCHA_NIGHT', '#NIGHT_DRIVE']],
  ['🏃 운동', ['#GYM_CARDIO', '#GOLF_RANGE']],
  ['🌤️ 날씨 · 야외', ['#RAINY_LOFI', '#ROOFTOP', '#HANGANG_PICNIC', '#SUMMER_BEACH', '#CAMPING']],
];
export const stGroupOf = (code) => Math.max(0, STATION_GROUPS.findIndex(([, c]) => c.includes(code)));

export const GENRES = [
  ['auto', '스테이션 기본'], ['citypop', '시티팝'], ['lofi', '로파이'], ['acoustic', '어쿠스틱'], ['jazz', '재즈'], ['bossa', '보사노바'],
  ['house', '하우스'], ['synthwave', '신스웨이브'], ['ambient', '앰비언트'], ['piano', '피아노'], ['funk', '펑크'], ['rock', '록'],
  ['hiphop', '힙합'], ['kballad', 'K-발라드'], ['trot', '트로트'], ['gugak', '국악 퓨전'], ['kpop', 'K-POP 댄스'], ['rnb', 'R&B · 소울'],
  ['indie', '인디 · 포크'], ['blues', '블루스'], ['reggae', '레게 · 트로피컬'], ['disco', '디스코'], ['dnb', '드럼앤베이스'],
  ['cinematic', '시네마틱 · OST'], ['neoclassic', '모던 클래식'], ['chillout', '칠아웃'],
];
export const GENRE = Object.fromEntries(GENRES);
export const LEADS = [['auto', '자동'], ['piano', '피아노'], ['guitar', '기타'], ['sax', '색소폰 · 트럼펫'], ['synth', '신디사이저'], ['strings', '현악기'], ['korean', '전통악기']];
export const FLOWS = [['auto', '자동'], ['steady', '잔잔하게 유지'], ['build', '점점 고조'], ['groove', '리듬감 있게'], ['drop', '잔잔하다 터지게'], ['dreamy', '몽환적으로'], ['catchy', '귀에 꽂히는 후크'], ['emotional', '감정 폭발'], ['cinematic', '영화처럼 웅장하게'], ['minimal', '미니멀하게'], ['calmdown', '점점 차분하게'], ['loop', '끊김 없이 반복용']];
export const WEATHERS = [['none', '상관없음'], ['sunny', '☀️ 맑음'], ['rain', '🌧 비'], ['snow', '❄️ 눈'], ['cloudy', '☁️ 흐림']];
export const TIMES = [['none', '상관없음'], ['morning', '아침'], ['afternoon', '오후'], ['evening', '저녁'], ['night', '밤'], ['fridaynight', '🌙 금요일 밤']];
export const DURATIONS = [90, 120, 150, 180, 210]; // 2026-11-06 90 · 210초 추가 (서버 STUDIO_DURATIONS 와 같아요)
export const KNOBS = [['warmth', '따뜻함', '차가움', '따뜻함'], ['energy', '바쁨', '한가함', '바쁨'], ['texture', '빈티지', '깔끔함', '빈티지']];
export const ENERGY_SHIFT = [-16, -8, 0, 8, 16];

export const VOICE_CATS = [['f', '👩 여자'], ['m', '👨 남자'], ['g', '👥 그룹'], ['fx', '🎛️ 이펙트']];
export const VOICES = [
  ['f_clear', 'f', '맑고 청아한 미성', '밝고 맑은 고음 · 상큼한 팝에 잘 어울려요'],
  ['f_whisper', 'f', '새벽 감성 · 귓속말 호흡', '숨소리가 많은 속삭이는 목소리 · 새벽 감성'],
  ['f_mature', 'f', '성숙하고 깊은 중저음 (알토)', '낮고 깊은 알토 · 차분한 발라드'],
  ['f_jazz', 'f', '스모키 재즈 · 허스키 소울', '까슬한 허스키 소울 · 재즈바 분위기'],
  ['f_rnb', 'f', '트렌디 R&B · 그루브', '꺾기와 리듬감이 살아 있는 R&B'],
  ['f_rap', 'f', '상큼한 싱잉랩 · 팝', '리듬을 타는 상큼한 랩과 팝 보컬'],
  ['f_diva', 'f', '폭발적 고음 · 파워 디바', '후렴에서 시원하게 터지는 고음'],
  ['f_folk', 'f', '담백한 이야기꾼 (포크)', '꾸밈없이 말하듯 부르는 통기타 감성'],
  ['f_trot', 'f', '간드러지는 정통 트로트', '구성진 꺾기와 비음 · 정통 트로트'],
  ['m_soft', 'm', '달콤하고 부드러운 미성', '달콤하고 부드러운 높은 남자 목소리'],
  ['m_indie', 'm', '나른한 카페 싱어송라이터', '힘을 뺀 나른한 카페 인디'],
  ['m_deep', 'm', '동굴 같은 묵직한 중저음', '굵고 묵직한 바리톤 · 깊은 울림'],
  ['m_rock', 'm', '거칠고 터프한 록 · 블루스', '거칠게 긁는 록 · 블루스 샤우팅'],
  ['m_rap', 'm', '멜로디 싱잉랩 · 트렌디 R&B', '멜로디를 타는 싱잉랩 · 트렌디 R&B'],
  ['m_ballad', 'm', '애절한 호소력 · 허스키 발라드', '애절하게 긁는 허스키 록발라드'],
  ['m_band', 'm', '시원한 고음 · 청량 밴드 보컬', '시원하게 뻗는 밴드 보컬 고음'],
  ['m_trot', 'm', '구수하고 힘 있는 성인가요', '구수한 중저음 · 힘 있는 성인가요'],
  ['duet', 'g', '남녀 설레는 어쿠스틱 듀엣', '절은 남자, 후렴은 여자가 받고 마지막은 함께'],
  ['group_girl', 'g', '청량 걸그룹 (다인원 하모니)', '여러 명의 맑은 여자 목소리 · 상큼한 화음'],
  ['group_boy', 'g', '에너제틱 보이그룹 (랩 + 보컬)', '남자 멤버들의 랩과 보컬 · 힘찬 떼창'],
  ['choir', 'g', '웅장한 가스펠 · 콰이어 합창단', '첫 소절부터 웅장한 다성부 합창'],
  ['fx_radio', 'fx', '📻 빈티지 라디오 (전화기 너머)', '옛날 라디오 · 전화기 너머 먹먹한 목소리'],
  ['fx_autotune', 'fx', '🤖 사이버펑크 오토튠 (기계음)', '음정이 딱딱 꺾이는 기계음 오토튠'],
  ['fx_echo', 'fx', '🌌 몽환적 우주 리버브 (드림팝)', '우주에 떠 있는 듯한 깊은 잔향'],
  ['fx_gugak', 'fx', '🪘 국악 소리꾼 (판소리 한 자락)', '시김새가 살아 있는 국악 퓨전 소리꾼'],
  // 2026-11-06 새 목소리 + 예전 목소리 다시 꺼내기 (앱과 같아요 · 미리 듣기 샘플은 준비 중)
  ['f_rock', 'f', '걸크러시 록 보컬', '거칠게 내지르는 걸크러시 록'],
  ['f_citypop', 'f', '시티팝 · 레트로 여성 보컬', '가볍고 숨결 섞인 80년대 시티팝'],
  ['f_ballad', 'f', '애틋한 발라드 여성 보컬', '잔잔한 절에서 후렴으로 차오르는 발라드'],
  ['f_husky', 'f', '따뜻한 허스키 소울', '따뜻하게 갈라지는 허스키 알토'],
  ['f_bright', 'f', '통통 튀는 상큼 발랄', '리듬 타는 밝고 발랄한 팝'],
  ['m_hiphop', 'm', '힙합 래퍼 (랩 + 후렴)', '절은 랩, 후렴은 멜로디로 부르는 힙합'],
  ['m_acoustic', 'm', '따뜻한 통기타 남자 보컬', '통기타에 어울리는 따뜻하고 담백한 목소리'],
  ['m_jazz', 'm', '벨벳 재즈 크루너', '부드러운 바리톤 · 스윙 재즈 크루너'],
  ['m_power', 'm', '힘 있는 바리톤', '가슴을 울리는 힘 있는 바리톤'],
  ['m_falsetto', 'm', '감성 가성 · 실키 R&B', '가성을 오가는 세련된 R&B'],
  ['indie_duo', 'g', '인디 혼성 투보컬', '남녀가 함께 부르는 따뜻한 인디 포크'],
].map(([id, cat, label, desc]) => ({ id, cat, label, desc }));
export const LEGACY_VOICES = { f_husky: '여자 · 허스키/소울', f_rap: '여자 · 트렌디 랩/팝', f_bright: '여자 · 상큼/발랄', m_power: '남자 · 파워풀', m_falsetto: '남자 · 감성 가성', indie_duo: '인디 혼성 투보컬' };
/** 목소리 다듬기 (2026-11-04): 칸마다 -1 · 0(자동) · 1 → 서버 VOICE_TUNE 과 같은 칸 */
export const VOICE_TUNE_ROWS = [
  ['range', '음역', '낮게', '높게'],
  ['texture', '질감', '맑게', '허스키'],
  ['vibrato', '떨림', '곧게', '풍성하게'],
  ['emotion', '감정', '담담하게', '터지게'],
  ['rap', '랩', '노래만', '랩 많이'],
];
export const voiceLabel = (id) => VOICES.find((v) => v.id === id)?.label || LEGACY_VOICES[id] || id;
export const QUICK_VOICES = ['f_clear', 'f_whisper', 'm_soft', 'm_indie', 'duet', 'f_rnb'];
/** 장르별로 먼저 보여 줄 목소리 (앱 studioGenreVoices 와 같아요 · 2026-11-08) */
const GENRE_VOICES = {
  trot: ['f_trot', 'm_trot'], hiphop: ['m_rap', 'f_rap', 'm_hiphop'], rnb: ['f_rnb', 'm_falsetto', 'm_rap'], jazz: ['f_jazz', 'm_jazz', 'f_husky'],
  bossa: ['f_jazz', 'f_whisper', 'm_jazz'], blues: ['f_jazz', 'm_rock', 'f_husky'], rock: ['m_rock', 'f_rock', 'm_band'], kballad: ['f_mature', 'm_ballad', 'f_ballad'],
  citypop: ['f_citypop', 'f_bright', 'm_soft'], disco: ['f_bright', 'f_citypop', 'f_diva'], funk: ['f_bright', 'm_rap', 'f_rnb'], kpop: ['group_girl', 'group_boy', 'f_rap'],
  gugak: ['fx_gugak', 'f_trot'], acoustic: ['f_folk', 'm_acoustic', 'indie_duo'], indie: ['m_indie', 'indie_duo', 'f_folk'], reggae: ['m_soft', 'f_bright'],
  lofi: ['f_whisper', 'm_indie'], ambient: ['f_whisper', 'f_mature', 'fx_echo'], chillout: ['f_whisper', 'm_indie', 'f_mature'], piano: ['f_mature', 'm_soft', 'f_ballad'],
  cinematic: ['choir', 'f_diva', 'm_power'], neoclassic: ['choir', 'f_mature', 'm_deep'], house: ['f_bright', 'fx_echo', 'fx_autotune'],
  synthwave: ['fx_echo', 'f_citypop', 'fx_autotune'], dnb: ['f_diva', 'fx_echo', 'f_bright'],
};
/** 첫 화면 목소리 추천 6개: 장르 추천 → 기본 목소리 (장르와 부딪히는 조용한 목소리는 빼요) · 고른 목소리가 없으면 마지막 자리에 */
export function voicePicks(tone, genre, n = 6) {
  const base = ['f_clear', 'f_whisper', 'm_soft', 'm_indie', 'duet', 'f_rnb', 'm_deep', 'f_mature'];
  const has = (id) => VOICES.some((v) => v.id === id);
  const clash = (id) => QUIET_VOICES.includes(id) && LOUD_GENRES.includes(genre);
  const out = [];
  for (const id of [...(GENRE_VOICES[genre] || []), ...base]) { if (out.length >= n) break; if (!out.includes(id) && has(id) && !clash(id)) out.push(id); }
  if (tone && !out.includes(tone)) { if (out.length >= n) out.pop(); out.push(tone); }
  return out;
}
export const QUIET_VOICES = ['f_whisper', 'f_folk', 'm_indie'];
export const LOUD_GENRES = ['funk', 'rock', 'house', 'synthwave', 'kpop', 'disco', 'dnb', 'hiphop', 'trot', 'cinematic'];
export const ADLIBS = [['hum', '🎵 도입부 허밍'], ['hype', '🙌 후렴 추임새 (예에~ 우후~)']];
export const NARR_POS = [['none', '안 함'], ['intro', '도입부 독백'], ['break', '간주 내레이션'], ['outro', '아웃트로 나지막이']];
export const NARR_TONE = [['deep', '부드러운 중저음'], ['calm', '쓸쓸한 차분함'], ['whisper', '속삭이는 감성'], ['dj', '라디오 DJ'], ['movie', '영화 속 독백']];
export const NARR_VOICE = [['auto', '노래 목소리 따라'], ['f', '여자 목소리'], ['m', '남자 목소리']];
export const NARR_HINT = {
  '#NIGHT_DRIVE': '창문을 조금 열어 둘게, 이 밤이 들어오게', '#WOOD_CAFE': '오늘은 커피가 조금 더 따뜻한 것 같아', '#RAINY_LOFI': '빗소리가 들리면, 꼭 네 생각이 나',
  '#FOCUS_CODE': '딱 한 줄만 더, 그러면 오늘은 끝', '#GYM_CARDIO': '숨 크게 한 번, 다시 가 보자', '#STUDY_CAFE': '오늘의 나, 생각보다 잘하고 있어',
  '#PUB_LOUNGE': '오늘 하루 어땠어? 천천히 얘기해 줘', '#MORNING_BAKERY': '좋은 아침, 빵 냄새가 먼저 인사해', '#WINE_BAR': '한 모금이면 충분해, 오늘 밤은',
  '#BOUTIQUE': '거울 속 오늘의 나, 꽤 괜찮잖아', '#SPA_YOGA': '천천히 들이쉬고, 길게 내쉬어요', '#ROOFTOP': '노을이 다 지기 전에, 너한테 말할게',
  '#DAWN_MOOD': '그냥, 갑자기 네가 보고 싶어서', '#HANGANG_PICNIC': '바람 좋다, 오늘은 그냥 여기 있자', '#SUMMER_BEACH': '이 여름, 오래 기억할 것 같아', '#POCHA_NIGHT': '오늘도 수고했어, 한잔하고 가',
};
export const LYRIC_HINT = {
  '#NIGHT_DRIVE': ['네온이 번지는 밤거리 위로', '오늘 밤은 멈추지 말아 줘'], '#WOOD_CAFE': ['창가 자리 햇살이 내려앉으면', '조금만 더 머물러 줄래'],
  '#RAINY_LOFI': ['유리창에 맺힌 빗방울처럼', '비가 그치면 우리 다시 걸어'], '#FOCUS_CODE': ['고요한 새벽 키보드 소리', '한 줄 한 줄 꿈을 써 내려가'],
  '#GYM_CARDIO': ['숨이 차올라도 멈추지 않아', '한 번 더 뛰어 끝까지 가'], '#STUDY_CAFE': ['펼쳐 둔 노트 위 작은 꿈', '오늘의 나는 어제보다 한 뼘'],
  '#PUB_LOUNGE': ['잔이 부딪히는 소리 사이로', '오늘 밤은 너와 나의 노래'], '#MORNING_BAKERY': ['갓 구운 빵 냄새 가득한 아침', '좋은 하루가 시작될 거야'],
  '#WINE_BAR': ['촛불이 흔들리는 테이블 너머로', '오늘 밤은 천천히 머물러 줘'], '#BOUTIQUE': ['새로 걸린 옷 사이를 걸으면', '오늘의 나는 조금 더 반짝여'],
  '#SPA_YOGA': ['깊게 들이쉬고 천천히 내쉬면', '지금 이대로 괜찮아'], '#ROOFTOP': ['노을이 번지는 옥상 끝에서', '이 순간을 오래 기억할게'],
  '#DAWN_MOOD': ['잠들지 못한 새벽 세 시에', '너의 이름을 조용히 불러 봐'], '#HANGANG_PICNIC': ['돗자리 위로 바람이 불어오면', '오늘은 너에게 말할 거야'],
  '#SUMMER_BEACH': ['창문을 열면 바다 냄새가 나', '이 여름이 끝나지 않게'], '#POCHA_NIGHT': ['퇴근길 포장마차 불빛 아래', '오늘도 수고했어 한잔 하자'],
  '#SALON_NAIL': ['거울 속 새로운 내가 웃어', '오늘은 나를 위한 날'], '#CLINIC_WAIT': ['창가로 들어오는 오후 햇살', '괜찮아질 거야 천천히'],
  '#BOOK_CAFE': ['책장을 넘기는 소리 사이로', '한 페이지씩 나에게로'], '#HOTEL_LOBBY': ['반짝이는 샹들리에 아래서', '오늘 밤은 조금 특별하게'],
  '#BRUNCH_CAFE': ['늦잠 잔 주말 햇살 가득한 테이블', '오늘은 천천히 맛있게'], '#FLOWER_SHOP': ['꽃잎 사이로 봄이 먼저 와', '너에게 건네고 싶은 한 다발'],
  '#GOLF_RANGE': ['힘껏 휘두른 그 순간', '멀리 더 멀리 날아가'], '#CAMPING': ['타닥타닥 모닥불 옆에서', '별이 쏟아지는 이 밤에'],
};

export const ERR = {
  TOPIC_EMPTY: '어떤 노래인지 한 줄로 적어 주세요.', TOPIC_LONG: '주제는 150자 안으로 적어 주세요.',
  TOPIC_COPYRIGHT: '기존 노래를 따라 하거나 가수 · 곡 이름이 들어간 주제는 쓸 수 없어요. 내 이야기로 적어 주세요.',
  TOPIC_UNSAFE: '이 주제로는 가사를 쓸 수 없어요. 누구나 들을 수 있는 이야기로 바꿔 주세요.',
  TOPIC_UNCLEAR: '주제를 조금 더 구체적으로 적어 주세요. 예: 퇴근길 버스에서 나를 위로하는 노래',
  LYRICS_DAILY_LIMIT: 'AI 작사는 하루 20번까지예요. 내일 다시 써 주세요.', LYRICS_AI_DOWN: 'AI 작사가 잠시 쉬고 있어요. 잠시 뒤 다시 눌러 주세요.',
  LYRICS_AI_RETRY: '가사가 규칙에 맞지 않게 나왔어요. 한 번 더 눌러 주세요.', SAME_LANG: '이미 그 언어로 부른 곡이에요.',
  DAILY_MAKE_LIMIT: '오늘 만들기를 다 썼어요. 내일(한국 시간 0시 이후) 다시 만들 수 있어요.',
  MONTHLY_MAKE_LIMIT: '이번 달 무료 만들기 5번을 다 썼어요. 다음 달 1일(한국 시간)에 다시 생겨요.',
  STUDIO_BUDGET: '오늘 무료 만들기가 붐벼서 마감됐어요. 내일(한국 시간 0시) 다시 열려요.', STUDIO_OFF: '만들기를 잠시 멈췄어요. 곧 다시 열게요.',
  LOGIN_REQUIRED: '이메일로 로그인해야 만들 수 있어요.', UPLOAD_SUSPENDED: '권리 문제로 업로드가 멈춰 있어서 지금은 만들 수 없어요.',
  DAILY_UPLOAD_LIMIT: '오늘 올릴 수 있는 곡 수를 다 썼어요. 내일 다시 올려 주세요.', TRIM_TOO_SHORT: '남길 구간이 60초 이상이어야 재생이 집계돼요.',
  ALREADY_PICKED: '이 묶음은 이미 한 테이크를 올렸어요.', NOT_READY: '아직 다 만들어지지 않았어요.', NOT_FOUND: '만든 기록을 찾지 못했어요.',
  MAKE_FAILED: '곡 만들기 요청이 실패했어요. 잠시 뒤 다시 시도해 주세요.', MORE_LIMIT: '이 레시피로 만들 수 있는 버전을 다 만들었어요.',
  REPAINT_RANGE: '다시 만들 구간은 3초~90초로 골라 주세요.', REPAINT_SOURCE: '이 테이크 음원을 읽지 못했어요. 잠시 뒤 다시 해 주세요.', STEMS_SOURCE: '이 테이크 음원을 읽지 못했어요. 잠시 뒤 다시 해 주세요.',
  REPAINT_OFF: '이 기능은 잠시 쉬고 있어요. 곧 다시 열게요.', STEMS_OFF: '이 기능은 잠시 쉬고 있어요. 곧 다시 열게요.', STEMS_LIMIT: '보컬 · 반주 나누기는 하루 10번까지예요. 내일 다시 해 주세요.',
  LYRICS_CONSENT: '직접 쓴 가사라는 데 동의해야 만들 수 있어요.', LYRICS_BLOCKS: '절(Verse)과 후렴(Chorus)을 모두 써 주세요.',
  LYRICS_LENGTH: '가사는 전체 4~20줄, 한 칸에 8줄까지 쓸 수 있어요.', LYRICS_LINE_LONG: '한 줄이 너무 길어요. 30자 안으로 줄을 나눠 주세요.',
  LYRICS_SPAM: '발음할 수 없는 자음 · 모음이나 같은 글자 반복은 빼 주세요.', LYRICS_BLOCKED: '가수 · 그룹 이름이나 욕설은 가사에 넣을 수 없어요.',
  VOCAL_OFF: '보컬곡 만들기를 잠시 멈췄어요.', NARR_EMPTY: '나레이션을 넣으려면 말할 문장을 한 줄 이상 써 주세요.', NARR_LENGTH: '나레이션은 2줄까지 쓸 수 있어요.',
  COMPOSE_BAD: '직접 찍은 멜로디를 읽지 못했어요. 음표를 3개 이상 찍었는지 확인해 주세요.',
  UPLOAD_DAILY_FILES: '오늘 올린 파일이 너무 많아요. 내일 다시 올려 주세요.', UPLOAD_TOO_BIG: '음원 파일은 50MB까지 올릴 수 있어요',
  UPLOAD_TYPE: 'mp3 · wav · m4a · flac · ogg 음원 파일만 올릴 수 있어요',
};
export const errText = (code) => ERR[code] || String(code || '곡 만들기 요청이 실패했어요. 잠시 뒤 다시 시도해 주세요.');

// ---- 레시피 ----
export const newRecipe = (station = '#WOOD_CAFE') => ({ station, genre: 'auto', warmth: 2, energy: 2, texture: 2, weather: 'none', time: 'none', lead: 'auto', flow: 'auto', duration: 150, theme: 'none', opening: 'auto' });
/** 노래 주제 · 감정 (보컬곡 1번 · 앱 studioThemes · 서버 STUDIO_THEMES 와 같아요): [키, 이름, 어울리는 공간(반주 기본)] */
export const THEMES = [
  ['flutter', '💘 설렘 · 고백', '#HANGANG_PICNIC'], ['crush', '🙈 짝사랑', '#DAWN_MOOD'], ['breakup', '💔 이별 · 그리움', '#DAWN_MOOD'],
  ['comfort', '🫂 위로 · 토닥토닥', '#WOOD_CAFE'], ['cheer', '💪 응원 · 힘내', '#GYM_CARDIO'], ['party', '🎉 신나는 파티', '#ROOFTOP'],
  ['travel', '✈️ 여행 · 떠나요', '#NIGHT_DRIVE'], ['friends', '🤝 우정 · 친구', '#HANGANG_PICNIC'], ['family', '🏠 가족 · 고마움', '#WOOD_CAFE'],
  ['birthday', '🎂 생일 · 축하', '#MORNING_BAKERY'], ['newstart', '🌱 졸업 · 새출발', '#MORNING_BAKERY'], ['confident', '😎 당당함 · 자존감', '#BOUTIQUE'],
  ['memory', '📼 추억 · 그때 그 시절', '#PUB_LOUNGE'], ['worklife', '🧑‍💼 직장인 · 퇴근길', '#POCHA_NIGHT'], ['summer', '🌊 여름 · 바다', '#SUMMER_BEACH'],
  ['winter', '❄️ 겨울 · 크리스마스', '#DAWN_MOOD'], ['anniversary', '💍 기념일 · 고마워', '#WOOD_CAFE'],
];
export const THEME = Object.fromEntries(THEMES.map(([k, n, st]) => [k, { name: n, station: st }]));
/** AI 작사 스타일 (앱 studioLyricPens · Heats · Talks · Views 와 같아요 · 2026-11-06) */
export const LY_PENS = [['auto', '결 자동'], ['real', '💬 대화체'], ['poetic', '🌙 시적 · 은유'], ['abstract', '🌫 추상 · 몽환'], ['cinema', '🎬 영화 한 장면'], ['confess', '🫀 감정 직설'], ['inner', '🪞 내면 독백'], ['story', '📖 이야기'], ['witty', '😄 위트'], ['hook', '🔁 후크송']];
export const LY_HEATS = [['auto', '감정 자동'], ['calm', '담담하게'], ['deep', '절절하게']];
export const LY_TALKS = [['auto', '말투 자동'], ['casual', '반말 · 친구처럼'], ['polite', '존댓말 · 다정하게']];
export const LY_VIEWS = [['auto', '시점 자동'], ['you', '나 → 너에게'], ['we', '우리 이야기'], ['self', '혼잣말'], ['story', '이야기꾼 (그 사람 이야기)']];
/** 곡 시작 (보컬곡 · 서버 STUDIO_OPENINGS 와 같아요) */
export const OPENINGS = [['auto', '자동 (버전마다 다르게)'], ['inst', '반주로 시작'], ['hum', '허밍으로 시작'], ['cold', '바로 노래부터'], ['hook', '후렴부터']];
export const bpmOf = (r) => Math.max(56, Math.min(170, (ST[r.station]?.bpm || 96) + ENERGY_SHIFT[r.energy ?? 2]));
export const genreName = (r) => r.genre === 'auto' ? (ST[r.station]?.ko || '') : GENRE[r.genre] || r.genre;
export const defaultTitle = (station, d = new Date()) => `${(ST[station]?.tag || '#우드톤카페').replace('#', '').replace(/\//g, ' ')} ${d.getMonth() + 1}${String(d.getDate()).padStart(2, '0')}`;

// ---- 가사 검사 (앱 lyricsProblem · 서버 checkLyrics 와 같은 규칙) ----
export const lines = (s) => String(s || '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
const llen = (l) => l.replace(/\s/g, '').length;
export const lyricLang = (t) => { const x = String(t).replace(/\[[^\]]*\]/g, ''); return /[぀-ヿ]/.test(x) ? 'ja' : /[가-힣]/.test(x) ? 'ko' : /[一-鿿]/.test(x) ? 'ja' : 'en'; };
const spam = (t) => /[ㄱ-ㅎㅏ-ㅣ]/.test(t) || /(\S)\1{5,}/.test(t.replace(/\s/g, ''));
export function lyricsProblem(v, c, b) {
  const V = lines(v), C = lines(c), B = lines(b);
  if (!V.length || !C.length) return 'LYRICS_BLOCKS';
  const total = V.length + C.length + B.length;
  if (total < 4 || total > 20 || V.length > 8 || C.length > 8 || B.length > 8) return 'LYRICS_LENGTH';
  const all = [...V, ...C, ...B], max = lyricLang(all.join('\n')) === 'en' ? 60 : 30;
  if (all.some((l) => llen(l) > max)) return 'LYRICS_LINE_LONG';
  if (spam(all.join('\n'))) return 'LYRICS_SPAM';
  return null;
}
export function narrProblem(n) {
  if (!n || n.pos === 'none') return null;
  const L = lines(n.text);
  if (!L.length) return 'NARR_EMPTY';
  if (L.length > 2) return 'NARR_LENGTH';
  const max = lyricLang(L.join('\n')) === 'en' ? 60 : 30;
  if (L.some((l) => llen(l) > max)) return 'LYRICS_LINE_LONG';
  if (spam(L.join('\n'))) return 'LYRICS_SPAM';
  return null;
}
export const lineWarn = (t) => (lyricLang(t) === 'en' ? 40 : 20);
export const normLyrics = (v, c, b) => [lines(v).join('\n'), lines(c).join('\n'), lines(b).join('\n')].join('\u0001');

/** 표시용 가사 "[Verse]\n…\n\n[Chorus]\n…" → 칸별 */
export function splitLyrics(text) {
  const out = { verse: '', chorus: '', bridge: '', narr: '' };
  let cur = null;
  for (const raw of String(text || '').split('\n')) {
    const m = raw.match(/^\[(Verse|Chorus|Bridge|Narration[^\]]*)\]/i);
    if (m) { const k = m[1].toLowerCase(); cur = k.startsWith('narr') ? 'narr' : k; continue; }
    if (cur && raw.trim()) out[cur] += (out[cur] ? '\n' : '') + raw.trim();
  }
  return out;
}

// ---- 남은 횟수 (studio_quota) ----
export function quotaOf(row) {
  if (!row) return null;
  const left = row.left_today ?? 0, daily = row.daily ?? 1, bonusLeft = row.bonus_left ?? 0;
  const q = { left, daily, enabled: row.enabled !== false, budgetOut: !!row.budget_out, maxTakes: row.max_takes ?? 2, period: row.period || 'day', bonusLeft, trialUntil: row.trial_until ? new Date(row.trial_until) : null };
  q.canMake = q.enabled && !q.budgetOut && left > 0;
  q.monthly = q.period === 'month';
  q.freeLeft = Math.max(0, Math.min(99, left - bonusLeft));
  q.led = !q.enabled || q.budgetOut ? 'CLOSED' : left > daily ? '∞' : `${left}/${daily}`;
  q.useLine = q.freeLeft <= 0 && bonusLeft > 0 ? `차트 보너스 만들기 1번을 써요 (남은 ${bonusLeft}번).` : q.monthly ? `이번 달 무료 만들기 1번을 써요 (남은 ${q.freeLeft}번).` : `오늘 만들기 1번을 써요 (남은 ${q.freeLeft}번).`;
  q.trialLine = !q.monthly && q.trialUntil ? `가입 첫 7일은 매일 1곡 · ${Math.max(1, Math.min(7, Math.floor((q.trialUntil - Date.now()) / 3600000 / 24) + 1))}일 남았어요. 그 뒤로는 한 달 5곡이에요.` : '';
  return q;
}
export function makeLabel(q, { needLyrics, aiBusy }) {
  const can = q?.canMake;
  if (needLyrics && can) return aiBusy ? 'AI가 가사를 쓰는 중…' : '✨ AI 가사 쓰기 · 확인하고 만들어요';
  if (!q) return '로그인하면 만들 수 있어요';
  if (!q.enabled) return '만들기를 잠시 멈췄어요';
  if (q.budgetOut) return '오늘 무료 만들기 마감 · 내일 다시 열려요';
  if (q.left <= 0) return q.monthly ? '이번 달 무료 만들기를 다 썼어요' : '오늘 만들기를 다 썼어요';
  if (q.freeLeft <= 0) return `만들기 · 차트 보너스 (${q.bonusLeft}번 남음)`;
  return q.monthly ? `만들기 · 무료 (이번 달 ${q.freeLeft}번 남음)` : `만들기 · 무료 (오늘 ${q.freeLeft}번 남음)`;
}

// ---- 말로 고치기 (앱 studio_edit.dart applyRequest 그대로) ----
const has = (t, ws) => ws.some((w) => t.includes(w));
export function diffDraft(a, b, vocal) {
  const lvl = (v) => `${v * 25}`, out = [];
  if (a.r.genre !== b.r.genre) out.push(`장르 ${GENRE[b.r.genre] || b.r.genre}`);
  if (a.r.energy !== b.r.energy) out.push(`바쁨 ${lvl(a.r.energy)}→${lvl(b.r.energy)} (${bpmOf(b.r)} BPM)`);
  if (a.r.warmth !== b.r.warmth) out.push(`따뜻함 ${lvl(a.r.warmth)}→${lvl(b.r.warmth)}`);
  if (a.r.texture !== b.r.texture) out.push(`빈티지 ${lvl(a.r.texture)}→${lvl(b.r.texture)}`);
  if (a.r.lead !== b.r.lead) out.push(`악기 ${Object.fromEntries(LEADS)[b.r.lead] || b.r.lead}`);
  if (a.r.flow !== b.r.flow) out.push(`흐름 ${Object.fromEntries(FLOWS)[b.r.flow] || b.r.flow}`);
  if (a.r.duration !== b.r.duration) out.push(`길이 ${b.r.duration}초`);
  if (vocal && a.tone !== b.tone) out.push(voiceLabel(b.tone));
  if (vocal) {
    const A = Object.fromEntries(ADLIBS);
    for (const k of b.adlib) if (!a.adlib.includes(k)) out.push(`+ ${A[k] || k}`);
    for (const k of a.adlib) if (!b.adlib.includes(k)) out.push(`− ${A[k] || k}`);
  }
  return out;
}
export function applyRequest(text, d0, vocal) {
  const d = { r: { ...d0.r }, tone: d0.tone, adlib: [...d0.adlib] };
  const t = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return d;
  const step = has(t, ['훨씬', '많이', '아주', '완전', '확']) ? 2 : 1;
  const clamp = (v) => Math.max(0, Math.min(4, v));
  const off = (w) => new RegExp(`${w}\\s*(은|는|을|를|도)?\\s*(빼|없애|말고|제외)`).test(t);
  if (has(t, ['신나', '신난', '빠르', '빠른', '경쾌', '업템포', '흥겹', '활기', '에너지'])) d.r.energy = clamp(d.r.energy + step);
  if (has(t, ['잔잔', '느리', '느린', '차분', '조용', '여유', '편안'])) d.r.energy = clamp(d.r.energy - step);
  if (has(t, ['따뜻', '따듯', '포근', '부드럽'])) d.r.warmth = clamp(d.r.warmth + step);
  if (has(t, ['차갑', '차가운', '쿨하', '쨍하', '시원'])) d.r.warmth = clamp(d.r.warmth - step);
  if (has(t, ['빈티지', '옛날', '레트로', '아날로그', '복고', '오래된', '엘피', 'lp'])) d.r.texture = clamp(d.r.texture + step);
  if (has(t, ['깔끔', '선명', '모던', '세련', '요즘'])) d.r.texture = clamp(d.r.texture - step);
  const leads = { piano: ['피아노', '건반'], guitar: ['기타'], sax: ['색소폰', '섹소폰', '트럼펫', '브라스', '관악'], synth: ['신디', '신스', '전자음'], strings: ['현악', '바이올린', '첼로', '스트링', '오케스트라'], korean: ['가야금', '해금', '대금', '전통악기', '국악기'] };
  for (const [k, ws] of Object.entries(leads)) for (const w of ws) { if (!t.includes(w)) continue; if (off(w)) { if (d.r.lead === k) d.r.lead = 'auto'; } else d.r.lead = k; }
  if (has(t, ['고조', '터지', '점점', '클라이맥스', '웅장하게'])) d.r.flow = 'build';
  if (has(t, ['리듬감', '그루브', '들썩', '춤추', '댄스'])) d.r.flow = 'groove';
  if (has(t, ['일정하게', '계속 잔잔', '배경음악', '배경 음악'])) d.r.flow = 'steady';
  const ds = DURATIONS, di = Math.max(0, Math.min(ds.length - 1, ds.indexOf(d.r.duration)));
  if (has(t, ['길게', '더 길', '늘려'])) d.r.duration = ds[Math.min(ds.length - 1, di + 1)];
  if (has(t, ['짧게', '더 짧', '줄여'])) d.r.duration = ds[Math.max(0, di - 1)];
  const sec = t.match(/(120|150|180)\s*초/); if (sec) d.r.duration = +sec[1];
  if (t.includes('3분')) d.r.duration = 180;
  if (t.includes('2분')) d.r.duration = 120;
  const gw = { citypop: ['시티팝'], lofi: ['로파이'], acoustic: ['어쿠스틱'], jazz: ['재즈'], bossa: ['보사노바'], house: ['하우스'], synthwave: ['신스웨이브'], ambient: ['앰비언트'], funk: ['펑크', '펑키'], rock: ['록', '락'], hiphop: ['힙합'], kballad: ['발라드'], trot: ['트로트', '뽕짝'], gugak: ['국악'], kpop: ['케이팝', 'k-pop', 'kpop', '아이돌'], rnb: ['알앤비', 'r&b', '소울'], indie: ['인디', '포크'], blues: ['블루스'], reggae: ['레게', '트로피컬'], disco: ['디스코'], dnb: ['드럼앤베이스', 'dnb'], cinematic: ['시네마틱', 'ost', '영화음악'], neoclassic: ['클래식'], chillout: ['칠아웃'] };
  for (const [k, ws] of Object.entries(gw)) {
    const hit = k === 'rock' ? /(^|\s)(록|락)(으로|로|\s|느낌|스타일|$)/.test(t) : has(t, ws);
    if (hit && !ws.some(off)) d.r.genre = k;
  }
  if (has(t, ['피아노 곡', '피아노곡', '피아노 솔로'])) d.r.genre = 'piano';
  if (vocal) {
    let male = has(t, ['남자', '남성', '남자 목소리']), female = has(t, ['여자', '여성']);
    if (male && female) { male = /(남자|남성)\s*(목소리|보컬)?\s*(으로|로)/.test(t); female = !male; }
    if (has(t, ['오토튠', '사이버', '로봇', '보코더'])) d.tone = 'fx_autotune';
    else if (has(t, ['라디오', '전화기', '먹먹'])) d.tone = 'fx_radio';
    else if (has(t, ['에코', '울림', '몽환적인 잔향', '공간감 있는 목소리'])) d.tone = 'fx_echo';
    else if (has(t, ['국악', '판소리', '소리꾼'])) d.tone = 'fx_gugak';
    else if (has(t, ['걸그룹'])) d.tone = 'group_girl';
    else if (has(t, ['보이그룹'])) d.tone = 'group_boy';
    else if (has(t, ['합창', '성가대', '코러스 크게'])) d.tone = 'choir';
    else if (has(t, ['혼성', '투보컬', '인디 듀엣', '듀엣', '남녀'])) d.tone = 'duet';
    else if (male) d.tone = has(t, ['랩', '래퍼']) ? 'm_rap' : has(t, ['가성', '팔세토', '알앤비', 'r&b']) ? 'm_rap' : has(t, ['꺾기', '구성진', '트로트 가수', '뽕끼']) ? 'm_trot' : has(t, ['담백', '인디', '수수한']) ? 'm_indie' : has(t, ['저음', '중저음', '낮은', '굵은']) ? 'm_deep' : has(t, ['록', '락', '거친', '스크래치']) ? 'm_rock' : has(t, ['발라드', '애절', '호소', '허스키']) ? 'm_ballad' : has(t, ['밴드', '파워', '힘있', '힘 있', '시원하게']) ? 'm_band' : 'm_soft';
    else if (female) d.tone = has(t, ['랩', '래퍼', '알앤비', 'r&b', '그루브']) ? 'f_rnb' : has(t, ['꺾기', '구성진', '애절', '트로트 가수', '뽕끼']) ? 'f_trot' : has(t, ['재즈', '라운지']) ? 'f_jazz' : has(t, ['포크', '통기타', '담백', '말하듯']) ? 'f_folk' : has(t, ['성숙', '중저음', '차분한 목소리', '낮은']) ? 'f_mature' : has(t, ['허스키', '소울', '쉰']) ? 'f_jazz' : has(t, ['속삭', '몽환', '숨소리']) ? 'f_whisper' : has(t, ['파워', '디바', '고음', '시원하게']) ? 'f_diva' : 'f_clear';
    if ((d.tone === 'f_clear' && d0.tone.startsWith('f_')) || (d.tone === 'm_soft' && d0.tone.startsWith('m_'))) d.tone = d0.tone;
    const tog = (k, w) => { if (!t.includes(w)) return; d.adlib = d.adlib.filter((x) => x !== k); if (!off(w)) d.adlib.push(k); };
    tog('hum', '허밍'); tog('hype', '추임새');
  }
  return d;
}

// ---- 말로 고치기 · 가사 요청 (앱 studio_edit.dart lyricStyleRequest · lyricRequest · sectionRequest 와 같아요 · 2026-11-08) ----
export function lyricStyleRequest(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const pen = /시적|은유|비유|시처럼/.test(t) ? 'poetic' : /추상|몽환적인 가사|모호/.test(t) ? 'abstract' : /영화 (한 )?장면|장면처럼|영상처럼/.test(t) ? 'cinema'
    : /직설|솔직하게|고백하듯|절규/.test(t) ? 'confess' : /독백|혼잣말|나한테 하는/.test(t) ? 'inner' : /웃기게|재밌게|재미있게|유머|위트/.test(t) ? 'witty'
    : /이야기처럼|스토리|줄거리/.test(t) ? 'story' : /대화하듯|말하듯|일상적/.test(t) ? 'real' : null;
  const heat = /담담|덤덤|잔잔한 가사/.test(t) ? 'calm' : /절절|애절|감정 폭발|터지게/.test(t) ? 'deep' : null;
  return { pen, heat };
}
/** 'rewrite' · 'bridge' · null */
export function lyricRequest(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (lyricStyleRequest(t).pen && /다시|새로|바꿔|고쳐|써/.test(t)) return 'rewrite';
  if (/브릿지|브리지/.test(t) && /넣|추가|붙|만들|써/.test(t) && !/브릿지\s*(은|는|를|을)?\s*(빼|없애)/.test(t)) return 'bridge';
  if (/가사|노랫말|작사/.test(t) && /바꿔|바꾸|다시|새로|고쳐|수정|다른|갈아|교체|변경/.test(t)) return 'rewrite';
  return null;
}
/** '후렴 · 1절 · 브릿지' → 'chorus' · 'verse' · 'bridge' · null */
export function sectionRequest(text) {
  const t = String(text).replace(/\s+/g, ' ');
  if (/후렴|코러스|하이라이트|chorus/i.test(t)) return 'chorus';
  if (/브릿지|브리지|bridge/i.test(t) && !/브릿지\s*(를|을)?\s*(넣|추가|붙)/.test(t)) return 'bridge';
  if (/(1|2|첫|두)\s*(번째)?\s*절|벌스|verse|도입부\s*가사/i.test(t) || /(^|\s)절\s*(부분|을|를|만|도|가사)/.test(t)) return 'verse';
  return null;
}
/** 구간 다시 만들기 분위기 (서버 REPAINT_STYLES 키) */
export function sectionStyleRequest(text) {
  const t = String(text).replace(/\s+/g, ' ');
  if (/클라이맥스|터지|폭발|드롭/.test(t)) return 'drop';
  if (/신나|세게|강하게|힘차|빠르게|에너지|업\s*되/.test(t)) return 'stronger';
  if (/잔잔|부드럽|조용|차분/.test(t)) return 'softer';
  if (/감성|감정|슬프|애절|절절/.test(t)) return 'emotional';
  if (/발음|또렷|뭉개/.test(t)) return 'clearer';
  if (/코러스\s*쌓|화음|합창/.test(t)) return 'choir';
  if (/랩/.test(t) && !/랩\s*(빼|없애)/.test(t)) return 'rap';
  if (/악기\s*(줄|빼)|어쿠스틱하게|담백하게/.test(t)) return 'stripped';
  return null;
}
