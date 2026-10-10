import './sentry.js';
import './style.css';
import { getMyProfile, requireAuth, updateMyProfile } from './api.js';
import { renderAvatar } from './avatar.js';
import { initAvatarMenu } from './avatarMenu.js';
import { initConsentBanner } from './consentBanner.js';
import { renderProfileCard, SOCIALS } from './profileCard.js';
import { checkPayload, formToPayload, MAX_PROJECTS, previewProfile, serverFieldErrors } from './profileForm.js';
import { getTheme, initThemeToggle, setTheme } from './theme.js';
import { clearFieldError, loadingLine, setBusy, showFieldError } from './ui.js';

// Your profile and settings. Signed-in only, never night-gated: students can
// edit their profile in the daytime too.

init();

async function init() {
  initConsentBanner();

  const form = document.getElementById('profile-form');
  const preview = document.getElementById('profile-preview');
  const errorBox = document.getElementById('error-box');
  const saveStatus = document.getElementById('save-status');
  preview.replaceChildren(loadingLine('LOADING PROFILE'));

  if (!(await requireAuth())) return; // already redirecting to the sign-in page

  const themeToggle = document.getElementById('theme-toggle');
  initThemeToggle(themeToggle);
  initAvatarMenu(document.getElementById('avatar-menu'));
  initLampSetting(themeToggle);

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add('visible');
  }

  let own;
  try {
    own = await getMyProfile();
  } catch (err) {
    preview.replaceChildren();
    showError(err.message);
    return;
  }

  buildSocialRows(document.getElementById('social-rows'));
  const addProject = document.getElementById('add-project');
  buildProjectRows(document.getElementById('project-rows'), addProject);
  fillForm(form, own);
  fillAccount(own);

  const renderPreview = () => preview.replaceChildren(renderProfileCard(previewProfile(formToPayload(form), own)));
  renderPreview();
  form.addEventListener('input', () => {
    saveStatus.textContent = '';
    renderPreview();
  });
  if (location.hash === '#settings') document.getElementById('settings').scrollIntoView();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.classList.remove('visible');
    saveStatus.textContent = '';
    for (const input of form.querySelectorAll('[aria-invalid]')) clearFieldError(input);

    const payload = formToPayload(form);
    const problems = checkPayload(payload);
    if (Object.keys(problems).length) {
      showFieldErrors(form, problems);
      return;
    }

    const done = setBusy(document.getElementById('save-profile'), 'SAVING...');
    try {
      own = await updateMyProfile(payload);
      fillForm(form, own); // the server's cleaned-up values ("@handle" -> "handle")
      renderPreview();
      document.querySelector('.avatar-button .avatar')?.replaceWith(
        renderAvatar({ avatarUrl: own.avatar_url, userId: own.id, size: 32 }),
      );
      saveStatus.textContent = 'SAVED.';
    } catch (err) {
      if (err.status === 422 && Array.isArray(err.data)) {
        const unplaced = showFieldErrors(form, serverFieldErrors(err.data));
        if (unplaced.length) showError(unplaced.join(' '));
      } else if (err.status === 409) {
        showFieldErrors(form, { display_name: err.message });
      } else {
        showError(err.message);
      }
    } finally {
      done();
    }
  });
}

// Puts each message under its field; returns the ones with no field to go under.
function showFieldErrors(form, errors) {
  let first;
  const unplaced = [];
  for (const [name, message] of Object.entries(errors)) {
    const input = form.elements[name];
    // Not a single field (a whole-list error, or a fieldset sharing the name).
    if (!input?.matches?.('input, select, textarea')) {
      unplaced.push(message);
      continue;
    }
    showFieldError(input, message);
    first ??= input;
  }
  first?.focus();
  return unplaced;
}

function input(name, { label, type = 'text', maxLength, placeholder } = {}) {
  const field = document.createElement('input');
  field.type = type;
  field.id = name;
  field.name = name;
  if (label) field.setAttribute('aria-label', label);
  if (maxLength) field.maxLength = maxLength;
  if (placeholder) field.placeholder = placeholder;
  return field;
}

function checkbox(name, text) {
  const label = document.createElement('label');
  label.className = 'choice';
  label.append(input(name, { type: 'checkbox' }), ` ${text}`);
  return label;
}

function buildSocialRows(container) {
  for (const { kind, label } of SOCIALS) {
    const row = document.createElement('div');
    row.className = 'field social-row';
    const caption = document.createElement('label');
    caption.htmlFor = `social-${kind}`;
    caption.textContent = label;
    const handle = input(`social-${kind}`, {
      maxLength: kind === 'website' ? 200 : 40,
      placeholder: kind === 'website' ? 'https://...' : 'handle',
    });
    row.append(caption, handle, checkbox(`social-${kind}-visible`, 'Show'));
    container.append(row);
  }
}

// Five title + link rows; the empty ones stay hidden until "Add another".
function buildProjectRows(container, addButton) {
  for (let i = 0; i < MAX_PROJECTS; i++) {
    const row = document.createElement('div');
    row.className = 'field project-row';
    row.append(
      input(`project-title-${i}`, { label: `Project ${i + 1} title`, maxLength: 80, placeholder: 'Title' }),
      input(`project-url-${i}`, { label: `Project ${i + 1} link`, type: 'url', maxLength: 300, placeholder: 'https://...' }),
    );
    container.append(row);
  }
  addButton.addEventListener('click', () => {
    const next = container.querySelector('.project-row[hidden]');
    if (!next) return;
    next.hidden = false;
    next.querySelector('input').focus();
    addButton.hidden = !container.querySelector('.project-row[hidden]');
  });
}

function fillForm(form, own) {
  const set = (name, value) => {
    form.elements[name].value = value ?? '';
  };
  form.elements.avatar.value = own.avatar_url ? 'photo' : 'pixel';
  document.getElementById('avatar-photo').disabled = !own.photo_url;
  document.getElementById('photo-hint').hidden = Boolean(own.photo_url);

  for (const name of ['display_name', 'name', 'pronouns', 'bio', 'status', 'major', 'year']) set(name, own[name]);
  form.elements.show_name.checked = own.show_name;
  set('interests', own.interests.join(', '));
  set('courses', own.courses.join(', '));

  for (const { kind } of SOCIALS) {
    const social = own.socials[kind];
    set(`social-${kind}`, social?.handle);
    form.elements[`social-${kind}-visible`].checked = social ? social.visible : true;
  }

  const rows = form.querySelectorAll('.project-row');
  rows.forEach((row, i) => {
    const project = own.projects[i];
    set(`project-title-${i}`, project?.title);
    set(`project-url-${i}`, project?.url);
    row.hidden = i > own.projects.length; // the filled rows and one empty one
  });
  document.getElementById('add-project').hidden = !form.querySelector('.project-row[hidden]');
}

function fillAccount(own) {
  document.getElementById('account-email').textContent = own.email;
  document.getElementById('account-school').textContent = own.school_name || 'Not found for your email domain';
  document.getElementById('account-timezone').textContent = own.timezone;
}

// The Lamp checkbox in Settings and the lamp in the top bar are one switch.
function initLampSetting(themeToggle) {
  const box = document.getElementById('lamp-setting');
  const sync = () => {
    box.checked = getTheme() === 'lamp';
  };
  sync();
  themeToggle.addEventListener('click', sync);
  box.addEventListener('change', () => {
    setTheme(box.checked ? 'lamp' : 'night');
    themeToggle.setAttribute('aria-pressed', String(box.checked));
  });
}
