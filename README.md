# yarr-web

YARR(야르) 홈페이지와 자동 검수 워커를 담은 저장소예요. **공개(Public) 저장소**로 만들어도 괜찮아요. 비밀값은 코드에 없고 GitHub Secrets 에만 들어가요.

| 폴더 | 내용 |
| --- | --- |
| `docs/` | 홈페이지 · 개인정보 처리방침 · 이용약관 · 계정 삭제 안내 (GitHub Pages) |
| `src/` | 페이지 원본과 `site.ini`(운영자 · 문의 메일 · 시행일). 고친 뒤 `python src/build.py` |
| `worker/` | 자동 검수 워커 (음량 측정 · -14 LUFS 변환 · YARR 안 중복 대조 · 제목 검사 · ACRCloud 대조 · 자동 승인/반려) |
| `.github/workflows/inspect.yml` | 30분마다 워커 실행 |

## 1. 홈페이지 켜기
1. GitHub 에서 새 저장소 `yarr-web` 을 **Public** 으로 만들고 이 폴더 내용을 올려요.
2. 저장소 → **Settings → Pages** → Source: `Deploy from a branch`, Branch: `main` / 폴더 `/docs` → Save.
3. 1~2분 뒤 주소가 생겨요: `https://<깃허브아이디>.github.io/yarr-web/`
   - 개인정보 처리방침: `…/yarr-web/privacy.html` ← Play Console 에 넣는 주소
   - 계정 삭제: `…/yarr-web/delete-account.html` ← Play Console 데이터 보안 양식에 넣는 주소

## 2. 자동 검수 켜기
저장소 → **Settings → Secrets and variables → Actions → New repository secret** 으로 아래를 넣어요.

| 이름 | 값 |
| --- | --- |
| `SUPABASE_URL` | `https://ixgwiwohdczeklnurmon.supabase.co` |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys 의 **secret** 키 (채팅 · 코드에 절대 붙여 넣지 말 것) |
| `ACR_HOST` · `ACR_ACCESS_KEY` · `ACR_ACCESS_SECRET` | (선택) ACRCloud 프로젝트 값. 없으면 대조는 '미연결', **자동 승인도 안 함** |

워크플로 파일: 저장소에는 `.github/workflows/inspect.yml` 로 들어 있어요 (PC 폴더의 `workflow-inspect.yml` 과 같은 내용).

### 자동 결정 규칙 (Supabase 에 `011` SQL 을 먼저 실행)
| 결과 | 언제 |
| --- | --- |
| **자동 반려** (이유가 크리에이터 화면에 보임) | ACRCloud 기존 곡 일치(점수 80+) · YARR 안 같은 음원(85%+) · 제목/프롬프트에 커버 표기 · 무료 플랜 · 무음 · 60초 미만 |
| **대기** (관리자 콘솔 검수 대기에 '⚠ 자동 보류: 이유') | 실존 가수 이름 · 제목 해시태그 · 원곡/메들리 표기 · 약한 유사(75~85%) · 15분 초과 · 검수 실패 · 최근 90일 권리 경고 이력 |
| **자동 승인** (다음 0시 공개, 공개 전 관리자 취소 가능) | 위에 하나도 안 걸리고 **ACRCloud 대조까지 통과**. 또는 운영사가 만든 **YARR 오리지널** 곡(ACRCloud 없이도 승인) |

ACRCloud 없이도 자동 승인하려면 **Variables** 탭에 `AUTO_APPROVE_WITHOUT_ACR` = `1` (믿을 만한 크리에이터만: 공개 곡 5곡 이상 · 90일 권리 경고 없음 · 가입 14일 이상 · 익명 아님. `014` SQL 필요).

### 곡이 많아졌을 때 (Supabase 에 `014` SQL)
- **경고 · 정지:** 권리 문제로 반려(표절 의심 · 실존 가수 · 중복 음원 · 라이선스 · 신고 인용)가 90일에 3번이면 30일 업로드 정지. 자동으로 풀려요.
- **사후 점검:** 자동 승인 곡 중 무작위 10% + 새 크리에이터의 첫 3곡은 공개 뒤 관리자 콘솔 '사후 점검'에 올라와요. 문제가 있으면 바로 내리고 경고 1번.
- **장난 신고:** 이미 기각된 곡이나, 기각이 2번 이상인 신고자의 신고는 곡을 바로 내리지 않고 관리자 판단을 기다려요.
- **운영 현황:** 관리자 콘솔 맨 위에 최근 7일 자동 처리 비율과 사람 손이 필요한 건수.

자동 승인 · 반려를 끄고 측정만 하려면 `AUTO_DECIDE` = `0`.

그다음 **Actions** 탭 → "YARR 자동 검수" → **Run workflow** 로 한 번 돌려 보세요. 이후 30분마다 자동으로 돌아요.
Public 저장소는 Actions 사용 시간이 무료예요.

## 3. 로컬에서 시험
```
pip install -r worker/requirements.txt
python worker/inspect.py --file 내노래.mp3 --title "곡 제목" --plan Pro --compare 다른곡.mp3
```
자동 결정이 어떻게 나올지(승인 · 반려 · 대기와 이유)까지 보여 줘요.
