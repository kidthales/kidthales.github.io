import { Controller } from '@hotwired/stimulus';

// Persistence

const localStorageKey = 'app/theme/prefers-dark';

function getPrefersDark() {
  return !!window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
}

function getStoredPrefersDark() {
  const value = localStorage.getItem(localStorageKey);
  return value === null ? null : value === 'true';
}

function setStoredPrefersDark(value: boolean | null) {
  if (value === null) {
    localStorage.removeItem(localStorageKey);
    return;
  }

  localStorage.setItem(localStorageKey, JSON.stringify(value));
}

// DOM

function setTheme(element: Element, scheme: 'light' | 'dark') {
  element.setAttribute('data-theme', scheme);
}

function removeTheme(element: Element) {
  element.removeAttribute('data-theme');
}

// Controller

export default class ThemeController extends Controller {
  private static singleton: ThemeController;

  private dark = false;
  private force = false;

  initialize() {
    if (ThemeController.singleton) {
      throw new ReferenceError('theme-controller is a singleton and should only be initialized once');
    }
    ThemeController.singleton = this;

    const storedPrefersDark = getStoredPrefersDark();
    const prefersDark = getPrefersDark();

    if (storedPrefersDark === null) {
      this.dark = prefersDark;
      return;
    }

    if (prefersDark && storedPrefersDark) {
      this.dark = true;
      setStoredPrefersDark(null);
      return;
    }

    if (prefersDark && !storedPrefersDark) {
      this.dark = false;
      this.force = true;
      return;
    }

    if (!prefersDark && storedPrefersDark) {
      this.dark = true;
      this.force = true;
      return;
    }

    this.dark = false;
    setStoredPrefersDark(null);

    if (this.force) {
      setTheme(document.documentElement, this.dark ? 'dark' : 'light');
    }
  }

  connect() {
    if (!(this.element instanceof HTMLHtmlElement)) {
      throw new TypeError("theme-controller 'element' must be a valid HTMLHtmlElement");
    }

    if (this.force) {
      setTheme(this.element, this.dark ? 'dark' : 'light');
    }
  }

  disconnect() {
    if (this.force) {
      removeTheme(this.element);
    }
  }

  toggle() {
    const prefersDark = getPrefersDark();

    this.dark = !this.dark;

    if (prefersDark && !this.dark) {
      this.force = true;
      setTheme(this.element, 'light');
      setStoredPrefersDark(false);
      return;
    }

    if (!prefersDark && this.dark) {
      this.force = true;
      setTheme(this.element, 'dark');
      setStoredPrefersDark(true);
      return;
    }

    this.force = false;
    removeTheme(this.element);
    setStoredPrefersDark(null);
  }
}
