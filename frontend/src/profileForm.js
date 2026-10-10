import { SOCIALS } from './profileCard.js';

// The profile form's pure logic: reading it into the PATCH /me/profile body,
// shaping that into the public preview, and placing the server's validation
// errors on the right fields.

export const MAX_PROJECTS = 5;
const USERNAME = /^[a-z0-9_]{3,20}$/;

const tags = (text) =>
  [...new Set((text || '').split(',').map((tag) => tag.trim()).filter(Boolean))];

export function formToPayload(form) {
  const data = new FormData(form);
  const text = (name) => (data.get(name) || '').toString().trim();

  const socials = {};
  for (const { kind } of SOCIALS) {
    const handle = text(`social-${kind}`);
    if (handle) socials[kind] = { handle, visible: data.get(`social-${kind}-visible`) === 'on' };
  }

  const projects = [];
  for (let i = 0; i < MAX_PROJECTS; i++) {
    const title = text(`project-title-${i}`);
    const url = text(`project-url-${i}`);
    if (title || url) projects.push({ title, url });
  }

  return {
    display_name: text('display_name'),
    name: text('name'),
    show_name: data.get('show_name') === 'on',
    pronouns: text('pronouns'),
    bio: text('bio'),
    status: text('status'),
    major: text('major'),
    year: text('year'),
    interests: tags(text('interests')),
    courses: tags(text('courses')),
    socials,
    projects,
    use_photo: data.get('avatar') === 'photo',
  };
}

// What other students would see, from the form as it is now (before saving).
export function previewProfile(payload, own) {
  return {
    id: own.id,
    display_name: payload.display_name || own.display_name,
    name: payload.show_name ? payload.name : null,
    avatar_url: payload.use_photo ? own.photo_url : null,
    school_name: own.school_name,
    pronouns: payload.pronouns,
    bio: payload.bio,
    status: payload.status,
    major: payload.major,
    year: payload.year,
    interests: payload.interests,
    courses: payload.courses,
    socials: Object.fromEntries(
      Object.entries(payload.socials).filter(([, social]) => social.visible).map(([kind, social]) => [kind, social.handle]),
    ),
    projects: payload.projects.filter((project) => project.title && project.url.startsWith('https://')),
  };
}

// Checks worth catching before a round trip; the server checks everything.
export function checkPayload(payload) {
  const errors = {};
  if (!USERNAME.test(payload.display_name)) {
    errors.display_name = 'Use 3–20 lowercase letters, numbers or _.';
  }
  payload.projects.forEach((project, i) => {
    if (!project.title) errors[`project-title-${i}`] = 'Give it a title.';
    if (!project.url.startsWith('https://')) errors[`project-url-${i}`] = 'Links must start with https://';
  });
  return errors;
}

// The server's 422 detail -> { fieldName: message }. Its `loc` looks like
// ["body", "display_name"] or ["body", "projects", 0, "url"].
export function serverFieldErrors(detail) {
  const errors = {};
  for (const problem of Array.isArray(detail) ? detail : []) {
    const [, field, index, part] = problem.loc || [];
    const message = (problem.msg || '').replace(/^Value error, /, '');
    if (field === 'projects' && Number.isInteger(index)) errors[`project-${part || 'url'}-${index}`] = message;
    else if (field === 'socials' && index) errors[`social-${index}`] = message;
    else if (field) errors[field] = message;
  }
  return errors;
}
