import type { Application } from '@hotwired/stimulus';

export {};

declare global {
  interface Window {
    Stimulus: Application;
  }

  const Stimulus: Window['Stimulus'];
}
