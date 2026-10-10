import { describe, it, expect, beforeEach } from 'vitest';
import { renderProfileCard } from '../src/profileCard.js';
import { checkPayload, formToPayload, previewProfile, serverFieldErrors } from '../src/profileForm.js';

const OWN = { id: 3, display_name: 'night_owl', photo_url: 'https://img.clerk.com/p.png', school_name: 'Test University' };

function makeForm(fields) {
  const form = document.createElement('form');
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.name = name;
    if (value === true) {
      input.type = 'checkbox';
      input.checked = true;
    } else {
      input.value = value;
    }
    form.append(input);
  }
  return form;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('formToPayload', () => {
  it('reads the form into the PATCH /me/profile body', () => {
    const form = makeForm({
      display_name: ' night_owl ',
      name: 'Sam',
      show_name: true,
      bio: 'late-night CS',
      interests: 'chess, lofi, , chess',
      courses: '',
      'social-github': 'octocat',
      'social-github-visible': true,
      'social-x': 'owl',
      'social-linkedin': '',
      'project-title-0': 'nightcord',
      'project-url-0': 'https://example.com',
      'project-title-1': '',
      'project-url-1': '',
      avatar: 'photo',
    });

    const payload = formToPayload(form);

    expect(payload.display_name).toBe('night_owl');
    expect(payload.show_name).toBe(true);
    expect(payload.interests).toEqual(['chess', 'lofi']);
    expect(payload.courses).toEqual([]);
    expect(payload.socials).toEqual({
      github: { handle: 'octocat', visible: true },
      x: { handle: 'owl', visible: false },
    });
    expect(payload.projects).toEqual([{ title: 'nightcord', url: 'https://example.com' }]);
    expect(payload.use_photo).toBe(true);
  });

  it('sends empty strings so cleared fields are cleared', () => {
    const payload = formToPayload(makeForm({ display_name: 'owl_1', bio: '', status: '' }));
    expect(payload.bio).toBe('');
    expect(payload.status).toBe('');
    expect(payload.socials).toEqual({});
  });
});

describe('previewProfile', () => {
  it('shows only what other students would see', () => {
    const payload = formToPayload(
      makeForm({
        display_name: 'night_owl',
        name: 'Sam',
        'social-github': 'shown',
        'social-github-visible': true,
        'social-instagram': 'hidden',
        avatar: 'pixel',
      }),
    );

    const preview = previewProfile(payload, OWN);

    expect(preview.name).toBeNull(); // "Show my name" is off
    expect(preview.avatar_url).toBeNull();
    expect(preview.socials).toEqual({ github: 'shown' });
    expect(preview.school_name).toBe('Test University');
  });

  it('uses the photo when opted in', () => {
    const payload = formToPayload(makeForm({ display_name: 'night_owl', avatar: 'photo' }));
    expect(previewProfile(payload, OWN).avatar_url).toBe(OWN.photo_url);
  });
});

describe('checkPayload', () => {
  it('catches a bad username and incomplete projects before saving', () => {
    const errors = checkPayload({
      display_name: 'Has Spaces',
      projects: [{ title: '', url: 'http://insecure.example' }],
    });
    expect(Object.keys(errors).sort()).toEqual(['display_name', 'project-title-0', 'project-url-0']);
  });

  it('passes a valid profile', () => {
    expect(checkPayload({ display_name: 'night_owl', projects: [{ title: 'a', url: 'https://a.dev' }] })).toEqual({});
  });
});

describe('serverFieldErrors', () => {
  it("maps the server's 422 details onto form fields", () => {
    const errors = serverFieldErrors([
      { loc: ['body', 'bio'], msg: 'String should have at most 160 characters' },
      { loc: ['body', 'display_name'], msg: 'Value error, Use 3-20 lowercase letters.' },
      { loc: ['body', 'projects', 1, 'url'], msg: 'Value error, Links must use https.' },
      { loc: ['body', 'socials', 'github', 'handle'], msg: 'Value error, Not a GitHub username.' },
      { loc: ['body', 'socials'], msg: "Value error, That doesn't look like a x handle." },
    ]);
    expect(errors).toEqual({
      bio: 'String should have at most 160 characters',
      display_name: 'Use 3-20 lowercase letters.',
      'project-url-1': 'Links must use https.',
      'social-github': 'Not a GitHub username.',
      socials: "That doesn't look like a x handle.",
    });
  });
});

describe('renderProfileCard', () => {
  it('puts everything in as text and links only https', () => {
    const card = renderProfileCard({
      id: 3,
      display_name: '<img src=x onerror=alert(1)>',
      bio: '<b>bold</b>',
      status: 'studying',
      interests: ['chess'],
      courses: [],
      socials: { github: 'octocat', discord: 'owl#1' },
      projects: [
        { title: 'safe', url: 'https://example.com' },
        { title: 'unsafe', url: 'javascript:alert(1)' },
      ],
    });

    expect(card.querySelector('img:not(.avatar-photo)')).toBeNull();
    expect(card.querySelector('.profile-username').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(card.querySelector('b')).toBeNull();
    expect(card.querySelector('.status-chip').textContent).toBe('Studying');

    const links = [...card.querySelectorAll('a')];
    expect(links.map((a) => a.textContent)).toEqual(['octocat', 'safe']); // Discord has no link
    expect(links.every((a) => a.rel === 'noopener noreferrer' && a.target === '_blank')).toBe(true);
    expect(links[0].href).toBe('https://github.com/octocat');
  });
});
