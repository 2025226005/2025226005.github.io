const field = (name, label, widget = 'string', extra = {}) => ({ name, label, widget, ...extra });
const year = () => field('year', '연도', 'number', { value_type: 'int', min: 1900, max: 2200, default: new Date().getFullYear() });
const order = () => field('order', '표시 순서 (작을수록 위)', 'number', { value_type: 'int', min: 0, max: 999999, default: 0, hint: '새 항목은 0이면 맨 위에 표시됩니다. 같은 순서일 때는 파일명 순입니다.' });
const members = (role) => field('members', '구성원 명단', 'list', {
  summary: '{{fields.name}}', collapsed: true, required: false,
  fields: [
    field('name', '이름 (한글 / 영문)'),
    field('photo', '프로필 사진', 'image', { hint: '컴퓨터에서 사진을 업로드하거나 기존 사진을 선택하세요.' }),
    field('photo_alt', '사진 설명', 'string', { required: false, hint: '비워 두면 이름이 사용됩니다.' }),
    field('role', '직위 / 현재 소속', 'string', { default: role }),
    field('details', '학력 · 재학 기간 · 이메일', 'text', { hint: '한 줄에 한 항목을 입력하세요. 이메일은 Email: name@example.com 형식으로 입력합니다.' })
  ]
});
const folder = (name, label, extra) => ({
  name, label, folder: `content/${name}`, create: true, delete: false,
  extension: 'json', format: 'json', editor: { preview: false }, ...extra
});
export function createConfig(settings) {
  return {
    load_config_file: false,
    backend: { name: 'github-token', repo: settings.repo, branch: settings.branch, api_root: 'https://api.github.com' },
    locale: 'ko', display_url: '../',
    media_folder: 'uploads/cms', public_folder: '/uploads/cms',
    slug: { encoding: 'ascii', clean_accents: true, sanitize_replacement: '-' },
    collections: [
      folder('undergraduates', '학부 연구생 · 연도별', {
        label_singular: '연도', slug: '{{fields.year}}', identifier_field: 'year', summary: '{{fields.year}}년 학부 연구생',
        sortable_fields: ['year'], view_groups: [],
        fields: [year(), members('Undergraduate Researcher')]
      }),
      { name: 'current', label: '현재 구성원', format: 'json', delete: false, editor: { preview: false }, files: [
        { name: 'members', label: '현재 구성원 명단', file: 'content/current.json', fields: [members('Graduate Student')] }
      ] },
      folder('alumni', '졸업생 · 학교별', {
        label_singular: '학교', slug: '{{slug}}', summary: '{{title}}',
        fields: [field('title', '학교 / 그룹 이름'), order(), members('Alumni')]
      }),
      folder('publications', '논문 · 학회 발표', {
        label_singular: '논문 / 발표', slug: '{{fields.year}}-{{slug}}', summary: '{{fields.year}} · {{title}}',
        sortable_fields: ['year', 'title', 'order'],
        view_groups: [{ label: '종류', field: 'category' }, { label: '연도', field: 'year' }],
        fields: [
          field('title', '관리용 제목', 'string', { hint: '목록에서 찾기 위한 제목입니다. 홈페이지에는 아래 인용문이 표시됩니다.' }),
          field('category', '종류', 'select', { options: [
            { label: 'Journal Publications (저널)', value: 'journal' },
            { label: 'Conference Publications & Abstracts (학회)', value: 'conference' },
            { label: 'Posters (포스터)', value: 'poster' }
          ] }), year(), order(),
          field('citation', '홈페이지에 표시할 인용문', 'markdown', {
            hint: '저자, 연도, 제목, 학술지/학회, 권·호, 페이지 등을 모두 작성하세요. 기울임꼴과 링크를 사용할 수 있습니다.',
            buttons: ['bold', 'italic', 'link'], editor_components: []
          })
        ]
      }),
      folder('news', '연구실 뉴스', {
        label_singular: '뉴스', slug: '{{slug}}', summary: '{{date_label}} · {{title}}',
        sortable_fields: ['order', 'title'],
        fields: [
          field('title', '뉴스 제목'), field('date_label', '표시 날짜', 'string', { hint: '예: Oct 26, 2026 또는 2026' }), order(),
          field('body', '본문 전체', 'text', { hint: '내용을 줄이지 않고 모두 입력하세요. 줄바꿈이 홈페이지에 반영됩니다.' }),
          field('summary', '첫 화면에 표시할 짧은 소개', 'text', { required: false, hint: 'News 본문과 별도입니다. 비워 두면 첫 화면에도 본문 전체가 표시됩니다.' }),
          field('link', '관련 링크 (선택)', 'string', { required: false, pattern: ['^https?://[^\\s<>"\\\\]+$', 'http:// 또는 https:// 주소를 입력하세요.'] })
        ]
      })
    ]
  };
}
