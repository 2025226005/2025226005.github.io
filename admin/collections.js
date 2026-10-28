const field = (name, label, widget = 'string', extra = {}) => ({ name, label, widget, ...extra });
const year = () => field('year', 'Year', 'number', { value_type: 'int', min: 1900, max: 2200, default: new Date().getFullYear() });
const order = () => field('order', 'Website order', 'hidden', { default: 0 });
const members = (role) => field('members', 'Members', 'list', {
  summary: '{{fields.name}}', collapsed: true, required: false, add_to_top: true, allow_reorder: true,
  hint: 'New members are added first. Drag the handles to change their order, or use Reorder on the collection page.',
  fields: [
    field('name', 'Name (Korean / English)'),
    field('photo', 'Profile photo', 'image', { hint: 'Upload a photo or choose an existing image.' }),
    field('photo_alt', 'Photo description', 'string', { required: false, hint: 'Leave blank to use the member’s name.' }),
    field('role', 'Role / current affiliation', 'string', { default: role }),
    field('details', 'Education, dates and email', 'text', { hint: 'One item per line. Use Email: name@example.com for email addresses.' })
  ]
});
const folder = (name, label, extra) => ({
  name, label, folder: `content/${name}`, create: true, delete: false,
  extension: 'json', format: 'json', editor: { preview: false }, ...extra
});
const websiteOrder = () => [{ field: 'order', label: 'Website order', default_sort: 'asc' }];
export function createConfig(settings) {
  return {
    load_config_file: false,
    backend: { name: 'github-token', repo: settings.repo, branch: settings.branch, api_root: 'https://api.github.com' },
    locale: 'en', display_url: '../',
    media_folder: 'uploads/cms', public_folder: '/uploads/cms',
    slug: { encoding: 'ascii', clean_accents: true, sanitize_replacement: '-' },
    collections: [
      folder('undergraduates', 'Undergraduate researchers', {
        label_singular: 'Year', slug: '{{fields.year}}', identifier_field: 'year', summary: '{{fields.year}} — Undergraduate researchers',
        sortable_fields: websiteOrder(),
        fields: [year(), order(), members('Undergraduate Researcher')]
      }),
      { name: 'current', label: 'Current members', format: 'json', delete: false, editor: { preview: false }, files: [
        { name: 'members', label: 'Current members', file: 'content/current.json', fields: [members('Graduate Student')] }
      ] },
      folder('alumni', 'Alumni', {
        label_singular: 'School group', slug: '{{slug}}', summary: '{{title}}', sortable_fields: websiteOrder(),
        fields: [field('title', 'School / group name'), order(), members('Alumni')]
      }),
      folder('publications', 'Publications & presentations', {
        label_singular: 'Publication / presentation', slug: '{{fields.year}}-{{slug}}', summary: '{{fields.year}} · {{title}}',
        sortable_fields: websiteOrder(),
        view_groups: [{ label: 'Type', field: 'category' }, { label: 'Year', field: 'year' }],
        fields: [
          field('title', 'Editor title', 'string', { hint: 'A short title for finding this entry. The full citation below is shown on the website.' }),
          field('category', 'Type', 'select', { options: [
            { label: 'Journal publication', value: 'journal' },
            { label: 'Conference publication / abstract', value: 'conference' },
            { label: 'Poster', value: 'poster' }
          ] }), year(), order(),
          field('citation', 'Full citation shown on the website', 'markdown', {
            hint: 'Include authors, year, title, journal/conference, volume and pages. Italics and links are supported. New publications appear first in their category.',
            buttons: ['bold', 'italic', 'link'], editor_components: []
          })
        ]
      }),
      folder('news', 'Lab news', {
        label_singular: 'News article', slug: '{{slug}}', summary: '{{date_label}} · {{title}}',
        sortable_fields: websiteOrder(),
        fields: [
          field('title', 'Title'), field('date_label', 'Display date', 'string', { hint: 'For example: Oct 27, 2026 or 2026' }), order(),
          field('body', 'Full article', 'text', { hint: 'Enter the complete article. Line breaks are preserved. New articles appear first.' }),
          field('summary', 'Home page introduction', 'text', { required: false, hint: 'Separate from the full article. Leave blank to show the full article on the home page.' }),
          field('link', 'Related link (optional)', 'string', { required: false, pattern: ['^https?://[^\\s<>"\\\\]+$', 'Enter an http:// or https:// URL.'] })
        ]
      })
    ]
  };
}
