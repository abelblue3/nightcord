import { renderAvatar } from './avatar.js';

// A student's profile as others see it: used by the live preview on the
// profile page and by the popup when you click someone in chat. Takes the
// public shape (GET /users/{id}/profile). Everything goes in as text, never
// HTML; links are only ever https.

export const STATUS_LABELS = { studying: 'Studying', open_to_chat: 'Open to chat', just_here: 'Just here' };

export const SOCIALS = [
  { kind: 'linkedin', label: 'LinkedIn', link: (h) => `https://www.linkedin.com/in/${encodeURIComponent(h)}` },
  { kind: 'github', label: 'GitHub', link: (h) => `https://github.com/${encodeURIComponent(h)}` },
  { kind: 'instagram', label: 'Instagram', link: (h) => `https://www.instagram.com/${encodeURIComponent(h)}` },
  { kind: 'x', label: 'X', link: (h) => `https://x.com/${encodeURIComponent(h)}` },
  { kind: 'discord', label: 'Discord', link: null }, // Discord has no profile links by username
  { kind: 'website', label: 'Website', link: (h) => h },
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function externalLink(href, text) {
  if (!href?.startsWith('https://')) return el('span', null, text);
  const link = el('a', null, text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function chips(title, values) {
  if (!values?.length) return null;
  const section = el('div', 'profile-section');
  section.append(el('h4', null, title));
  const list = el('ul', 'chip-list');
  for (const value of values) list.append(el('li', 'chip', value));
  section.append(list);
  return section;
}

export function renderProfileCard(profile) {
  const card = el('article', 'profile-card');

  const header = el('div', 'profile-header');
  header.append(renderAvatar({ avatarUrl: profile.avatar_url, userId: profile.id, size: 64 }));
  const who = el('div', 'profile-who');
  who.append(el('h3', 'profile-username', profile.display_name));
  const nameLine = [profile.name, profile.pronouns].filter(Boolean).join(' · ');
  if (nameLine) who.append(el('p', 'profile-name', nameLine));
  if (profile.school_name) who.append(el('p', 'profile-school', profile.school_name));
  header.append(who);
  card.append(header);

  if (profile.status) card.append(el('p', `status-chip status-${profile.status}`, STATUS_LABELS[profile.status]));
  if (profile.bio) card.append(el('p', 'profile-bio', profile.bio));
  const studies = [profile.major, profile.year].filter(Boolean).join(' · ');
  if (studies) card.append(el('p', 'profile-studies', studies));

  for (const section of [chips('Interests', profile.interests), chips('Courses', profile.courses)]) {
    if (section) card.append(section);
  }

  const socials = SOCIALS.filter(({ kind }) => profile.socials?.[kind]);
  if (socials.length) {
    const section = el('div', 'profile-section');
    section.append(el('h4', null, 'Socials'));
    const list = el('ul', 'link-list');
    for (const { kind, label, link } of socials) {
      const handle = profile.socials[kind];
      const item = el('li');
      item.append(el('span', 'link-label', `${label}: `));
      item.append(link ? externalLink(link(handle), handle) : el('span', null, handle));
      list.append(item);
    }
    section.append(list);
    card.append(section);
  }

  if (profile.projects?.length) {
    const section = el('div', 'profile-section');
    section.append(el('h4', null, 'Projects & publications'));
    const list = el('ul', 'link-list');
    for (const project of profile.projects) {
      const item = el('li');
      item.append(externalLink(project.url, project.title));
      list.append(item);
    }
    section.append(list);
    card.append(section);
  }

  return card;
}
