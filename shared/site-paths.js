/** Path helpers for GitHub Pages (repo subfolder) and local dev. */
export const REPO_NAME = 'Isaac_Interactive_Resume';

export function isGitHubPagesRepo() {
  return window.location.pathname.includes(`/${REPO_NAME}/`);
}

export function getDataPackPath() {
  if (isGitHubPagesRepo()) {
    return `/${REPO_NAME}/data/resume_pack.json`;
  }
  return new URL('../data/resume_pack.json', window.location.href).pathname;
}

/** @param {string} segment e.g. "portfolio/", "3d-resume/", "interactive_resume_spacecadets_v6_singlefile.html" */
export function siteUrl(segment) {
  const clean = segment.replace(/^\//, '');
  if (isGitHubPagesRepo()) {
    return `/${REPO_NAME}/${clean}`;
  }
  if (clean.startsWith('portfolio')) return '../portfolio/';
  if (clean.startsWith('3d-resume')) return '../3d-resume/';
  if (clean.includes('interactive_resume')) return '../interactive_resume_spacecadets_v6_singlefile.html';
  return `../${clean}`;
}
