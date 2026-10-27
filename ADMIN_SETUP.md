# GitHub만 사용하는 SSAIL 관리자 설정

기존 GitHub 계정에서 홈페이지 저장소 전용 관리 키(Fine-grained Personal Access Token)를 발급해 사용합니다. Cloudflare 가입, OAuth App 등록, 별도 인증 서버는 필요하지 않습니다.

현재 로컬 코드는 이 방식으로 변경했습니다. 실제 키를 발급하거나 원격 저장소에 파일을 올리지는 않았습니다. 실제 키로 읽기·저장·자동 게시까지 확인하는 절차는 최초 설정 시 진행합니다.

## 1. 홈페이지용 관리 키 만들기

홈페이지 저장소 소유자인 **2025226005 계정**으로 GitHub에 로그인합니다.

[관리 키 만들기 (이름·90일·Contents 쓰기 권한 미리 입력)](https://github.com/settings/personal-access-tokens/new?name=SSAIL%20Website%20Admin&target_name=2025226005&expires_in=90&contents=write)

다음 내용을 확인합니다.

| 설정 | 입력/선택 |
| --- | --- |
| Token name | SSAIL Website Admin |
| Expiration | 90 days 또는 원하는 만료일 |
| Resource owner | 2025226005 |
| Repository access | Only select repositories |
| Selected repositories | 2025226005.github.io |
| Repository permissions → Contents | Read and write |
| Metadata | Read-only (자동 포함) |

다른 권한은 추가하지 않습니다. 특히 이 키로 홈페이지 소스를 처음 업로드하거나 워크플로 파일을 수정할 필요는 없으므로 Workflows 권한은 주지 않습니다.

**Generate token**을 누르고 `github_pat_`로 시작하는 값을 복사해 비밀번호 관리자 등에 보관합니다. 새로 발급할 때만 전체 값이 표시됩니다. 이 값은 비밀번호와 같은 관리 키입니다. 채팅, 스크린샷, 홈페이지 소스나 `admin/config.json`에 넣지 않습니다.

[GitHub의 Fine-grained token 공식 안내](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

이 절차는 저장소 소유자 본인이 관리하는 현재 용도에 맞습니다. 개인 저장소의 외부 협업자 계정에서는 Fine-grained token으로 쓰기가 제한될 수 있습니다. 공동 관리자가 필요하면 각 계정의 권한에 맞는 별도 인증 방식을 검토합니다. 키를 공용 비밀번호처럼 공유하지 않습니다.

## 2. 준비한 홈페이지 소스 업로드

대상은 `2025226005/2025226005.github.io`, 브랜치는 `main`입니다.

소스 위치: `C:\Users\SSL\Documents\homepage\github-pages-sail`

이 폴더 자체가 아닌 **그 안의 소스 파일과 폴더**를 GitHub 저장소 루트에 올립니다. GitHub 웹사이트에서 로그인한 계정으로 업로드하거나, 기존 Git 도구를 사용합니다.

포함할 내용:

- HTML 파일, `site.css`, `site.js`
- `admin/`, `content/`, `uploads/`, `tools/`
- `.github/workflows/pages.yml`, `.nojekyll`, `.gitignore`
- `package.json`, `package-lock.json`, 안내 문서
- `oauth-worker/`는 기존 테스트 명령이 이 폴더의 테스트도 확인하므로 함께 보관합니다. 현재 인증에서는 실행하거나 배포하지 않으며 사이트 배포물에도 포함되지 않습니다.

`node_modules/`, `_site/`, 비밀키 파일은 업로드하지 않습니다. 특히 관리 키를 업로드할 파일에 붙여 넣지 않습니다. `admin/config.json`에는 공개 정보인 저장소 이름과 브랜치만 있습니다. 로컬 `CNAME`은 현재 업로드에서 제외합니다. 원격 저장소에서 삭제된 도메인 설정을 이 작업으로 다시 적용하지 않으며, 학교 도메인 연결은 나중에 별도로 설정합니다.

GitHub 웹 업로드는 한 번에 많은 파일을 올리는 데 제한이 있으므로 이미지가 많으면 폴더별로 나누거나 Git 도구로 전체를 반영합니다. 기존 홈페이지 파일의 변경사항도 확인해서 업로드합니다.

## 3. 자동 게시 설정

저장소의 **Settings → Pages → Build and deployment → Source**에서 **GitHub Actions**를 선택합니다.

Actions 탭에서 **Publish SSAIL website**를 실행하거나 새 커밋으로 실행된 작업의 성공을 확인합니다. `Deploy from a branch` 방식으로 남아 있으면 관리자에서 수정한 JSON이 최신 HTML로 변환되지 않습니다.

워크플로는 테스트 → HTML 생성 → `_site/` 배포 순서로 실행됩니다. 학교 도메인 설정은 기존대로 유지합니다. 학교 DNS 연결이 완료되지 않았다면 실제로 접속되는 GitHub Pages 주소로 먼저 확인합니다.

[GitHub Pages의 Actions 게시 공식 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## 4. 관리자 접속

게시된 HTTPS 홈페이지 주소 뒤에 `/admin/`을 붙입니다.

- 학교 도메인 연결 완료 시: `https://ssail.korea.ac.kr/admin/`
- GitHub 기본 도메인을 사용하는 경우: `https://2025226005.github.io/admin/` (학교 도메인으로 리디렉션될 수 있습니다.)

발급한 키를 **GitHub 관리 키** 입력란에 붙여 넣고 **관리 화면 열기**를 누릅니다. 관리 화면이 열리면 기존 연도별 학생과 사진, 논문, 뉴스가 읽히는지 확인합니다.

키는 창의 메모리에서만 사용하고 저장된 로그인 정보에는 포함하지 않습니다. 새로고침하거나 창을 닫으면 다시 입력해야 합니다. 파일을 더블클릭한 `file://`에서는 접속하지 않습니다. 접속한 웹페이지는 GitHub에 있는 원본 데이터를 읽고 저장합니다.

실제로 추가할 항목 한 건을 작성해 게시한 뒤, GitHub의 새 커밋과 Actions 배포 성공을 확인합니다. 현재 자동 테스트는 키 입력·편집 모듈 연결 및 HTML 생성을 확인했으며, 본인의 실제 키를 이용한 온라인 저장은 이 단계에서 처음 검증합니다.

## 평소 사용

- **2027년 학부 연구생:** 학부 연구생 · 연도별 → 새 연도 → 2027 → 구성원 추가 → 이름/사진/직위/학력 → 게시. 2027 탭은 자동 생성됩니다. 기존 연도의 숫자를 바꾸기보다 새 연도를 생성하세요.
- **기존 연도에 학생 추가:** 해당 연도의 구성원 목록에 한 명을 더 추가합니다. 목록 내부 순서는 드래그해서 조정합니다.
- **논문/학회 발표:** 종류, 연도, 표시 순서, 인용문 전체를 입력합니다. 인용문은 기울임꼴과 링크를 지원합니다.
- **뉴스:** 본문 전체와 홈 화면용 소개를 따로 입력합니다. 표시 순서가 앞선 세 항목이 홈에 표시됩니다.
- **표시 순서:** 작은 수가 먼저입니다. 새 항목의 기본값 0은 기존 항목보다 위에 표시됩니다. 같은 수이면 파일명 순서입니다.
- **사진:** 업로드하면 `uploads/cms/`에 저장됩니다.
- **저장 후:** GitHub Actions의 배포 성공을 기다린 뒤 홈페이지를 새로고침합니다.

관리 대상은 학부 연구생, 현재 구성원, 졸업생, 논문/발표, 뉴스입니다. 교수 소개·Research·Teaching·Contact는 기존 HTML에서 수정합니다. 연도/논문/뉴스 파일 통째 삭제는 실수 방지를 위해 관리 화면에서 꺼 두었습니다. 구성원 목록 내부 항목의 제거는 가능합니다.

## 키 만료·오류·복구

- **키가 만료되거나 분실됨:** GitHub에서 새 Fine-grained token을 발급하고 같은 홈페이지 저장소와 Contents 쓰기 권한을 지정합니다. 홈페이지 코드를 수정할 필요는 없습니다.
- **키가 노출됨:** GitHub 토큰 설정에서 해당 키를 삭제하고 새로 발급합니다.
- **관리 화면이 열리지 않음:** 저장소 소유자 계정, 선택한 저장소, 만료일, Contents 권한, 최신 관리자 파일 업로드 여부를 확인합니다.
- **읽기는 되는데 저장이 거부됨:** Contents의 Read and write 여부와 브랜치 보호 규칙을 확인합니다. 보호 규칙을 임의로 해제하지 말고 적절한 승인 흐름을 구성합니다.
- **저장 후 홈페이지가 그대로:** 저장 커밋과 Actions 배포 결과를 따로 확인합니다. 배포 실패 시 마지막 정상 홈페이지가 유지됩니다.
- **편집 실수:** GitHub 변경 이력에서 해당 콘텐츠 변경만 되돌리고 다시 배포합니다. 다른 사람의 새 변경은 보존하세요.

루트 HTML은 디자인 템플릿과 전환 전 보존본이며, 관리자가 편집한 최신 내용은 `content/`에서 생성된 `_site/`에 반영됩니다. 로컬 편집을 다시 시작할 때에는 먼저 GitHub의 최신 콘텐츠와 사진을 내려받습니다.

로컬 검증 명령은 `npm test`, 생성 명령은 `npm run build`입니다. `npm run check:migration`은 최초 보존 대조용으로, 이후 정상적인 콘텐츠 변경 뒤에는 기존 HTML과 달라져 실패할 수 있습니다.
