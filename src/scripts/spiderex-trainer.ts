import {
  generateSpiderexDrill,
  parseSpiderexParams,
  formatSpiderexAsciiTab,
  getTodayLocalDate,
  type SpiderexDrill,
  type SpiderexParams,
  type StringCount,
} from '../lib/spiderex.ts';
import {
  renderWarmupFretboardSvg,
  renderWarmupCards,
  renderTwisterSystems,
} from '../lib/spiderex-render.ts';

/**
 * Copies text to clipboard with a robust fallback to selection + execCommand.
 */
async function copyToClipboard(text: string, fallbackElement?: HTMLElement | null): Promise<boolean> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Proceed to fallback
    }
  }

  if (fallbackElement && typeof window.getSelection === 'function' && typeof document.createRange === 'function') {
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(fallbackElement);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const successful = document.execCommand('copy');
      selection?.removeAllRanges();
      if (successful) return true;
    } catch {
      // Fallback failed
    }
  }

  return false;
}

/**
 * <spiderex-trainer> Custom Element island.
 * Performs in-place hydration, URL query state sync, and drill regeneration with 0.0000 CLS.
 */
export class SpiderexTrainerElement extends HTMLElement {
  private currentParams: SpiderexParams = {
    date: '2026-01-01',
    variant: 1,
    strings: 6,
    skip: false,
  };
  private currentDrill: SpiderexDrill | null = null;
  private copyTimeoutId: number | null = null;

  // DOM element references
  private dateInput: HTMLInputElement | null = null;
  private todayBtn: HTMLButtonElement | null = null;
  private prevBtn: HTMLButtonElement | null = null;
  private nextBtn: HTMLButtonElement | null = null;
  private variantBadge: HTMLElement | null = null;
  private stringsSelect: HTMLSelectElement | null = null;
  private skipCheckbox: HTMLInputElement | null = null;
  private copyBtn: HTMLButtonElement | null = null;
  private statusEl: HTMLElement | null = null;
  private warmupFretboard: HTMLElement | null = null;
  private warmupGrid: HTMLElement | null = null;
  private twisterSystems: HTMLElement | null = null;
  private twisterTabCode: HTMLElement | null = null;
  private metaSummary: HTMLElement | null = null;

  connectedCallback(): void {
    this.bindDomElements();

    // Read initial params from element dataset or fallback to canonical seed
    const dsDate = this.getAttribute('data-date');
    const dsVariant = this.getAttribute('data-variant');
    const dsStrings = this.getAttribute('data-strings');
    const dsSkip = this.getAttribute('data-skip');

    const baseParams: SpiderexParams = parseSpiderexParams({
      date: dsDate || '2026-01-01',
      variant: dsVariant ? parseInt(dsVariant, 10) : 1,
      strings: dsStrings ? (parseInt(dsStrings, 10) as StringCount) : 6,
      skip: dsSkip === 'true' || dsSkip === '1',
    });

    // Inspect URL search params if present
    const hasSearch = typeof window !== 'undefined' && Boolean(window.location?.search);
    const searchParams = hasSearch ? new URLSearchParams(window.location.search) : null;
    const hasExplicitDate = searchParams?.has('date') ?? false;

    if (hasSearch && searchParams) {
      const urlParams = parseSpiderexParams(searchParams);
      if (!hasExplicitDate) {
        urlParams.date = getTodayLocalDate();
      }
      this.currentParams = urlParams;
      this.syncInputs();
      this.regenerate(false);
    } else {
      this.currentParams = {
        ...baseParams,
        date: getTodayLocalDate(),
      };
      this.syncInputs();
      this.regenerate(false);
    }

    this.attachEventListeners();
  }

  disconnectedCallback(): void {
    if (this.copyTimeoutId !== null) {
      window.clearTimeout(this.copyTimeoutId);
      this.copyTimeoutId = null;
    }
  }

  private bindDomElements(): void {
    this.dateInput = this.querySelector<HTMLInputElement>('#spiderex-date');
    this.todayBtn = this.querySelector<HTMLButtonElement>('#spiderex-today');
    this.prevBtn = this.querySelector<HTMLButtonElement>('#spiderex-prev');
    this.nextBtn = this.querySelector<HTMLButtonElement>('#spiderex-next');
    this.variantBadge = this.querySelector<HTMLElement>('#spiderex-variant-badge');
    this.stringsSelect = this.querySelector<HTMLSelectElement>('#spiderex-strings');
    this.skipCheckbox = this.querySelector<HTMLInputElement>('#spiderex-skip');
    this.copyBtn = this.querySelector<HTMLButtonElement>('#spiderex-copy');
    this.statusEl = this.querySelector<HTMLElement>('#spiderex-status');
    this.warmupFretboard = this.querySelector<HTMLElement>('#spiderex-warmup-fretboard');
    this.warmupGrid = this.querySelector<HTMLElement>('#spiderex-warmup-grid');
    this.twisterSystems = this.querySelector<HTMLElement>('#spiderex-twister-systems');
    this.twisterTabCode = this.querySelector<HTMLElement>('#spiderex-twister-tab');
    this.metaSummary = this.querySelector<HTMLElement>('#spiderex-meta-summary');
  }

  private syncInputs(): void {
    if (this.dateInput) this.dateInput.value = this.currentParams.date;
    if (this.stringsSelect) this.stringsSelect.value = String(this.currentParams.strings);
    if (this.skipCheckbox) this.skipCheckbox.checked = this.currentParams.skip;
    if (this.variantBadge) this.variantBadge.textContent = `v${this.currentParams.variant}`;
    if (this.prevBtn) this.prevBtn.disabled = this.currentParams.variant <= 1;
  }

  private attachEventListeners(): void {
    this.dateInput?.addEventListener('change', () => {
      if (this.dateInput && this.dateInput.value) {
        this.currentParams.date = this.dateInput.value;
        this.currentParams.variant = 1;
        this.syncInputs();
        this.regenerate(true);
      }
    });

    this.todayBtn?.addEventListener('click', () => {
      this.currentParams.date = getTodayLocalDate();
      this.currentParams.variant = 1;
      this.syncInputs();
      this.regenerate(true);
    });

    this.prevBtn?.addEventListener('click', () => {
      if (this.currentParams.variant > 1) {
        this.currentParams.variant--;
        this.syncInputs();
        this.regenerate(true);
      }
    });

    this.nextBtn?.addEventListener('click', () => {
      this.currentParams.variant++;
      this.syncInputs();
      this.regenerate(true);
    });

    this.stringsSelect?.addEventListener('change', () => {
      if (this.stringsSelect) {
        const val = parseInt(this.stringsSelect.value, 10);
        if (val === 4 || val === 6 || val === 7) {
          this.currentParams.strings = val;
          this.regenerate(true);
        }
      }
    });

    this.skipCheckbox?.addEventListener('change', () => {
      if (this.skipCheckbox) {
        this.currentParams.skip = this.skipCheckbox.checked;
        this.regenerate(true);
      }
    });

    this.copyBtn?.addEventListener('click', async () => {
      if (!this.currentDrill) {
        this.currentDrill = generateSpiderexDrill(this.currentParams);
      }
      const ascii = formatSpiderexAsciiTab(this.currentDrill);
      const copied = await copyToClipboard(ascii, this.twisterTabCode);

      if (copied && this.copyBtn) {
        this.copyBtn.textContent = 'Copied!';
        if (this.statusEl) {
          this.statusEl.textContent = 'Tablature copied to clipboard.';
        }
        if (this.copyTimeoutId !== null) {
          window.clearTimeout(this.copyTimeoutId);
        }
        this.copyTimeoutId = window.setTimeout(() => {
          if (this.copyBtn) {
            this.copyBtn.textContent = 'Copy Tab';
          }
          this.copyTimeoutId = null;
        }, 2000);
      }
    });
  }

  /**
   * Regenerates drill state and updates DOM with zero layout shift.
   */
  public regenerate(updateUrl = true): void {
    this.currentDrill = generateSpiderexDrill(this.currentParams);
    const { params, seed, warmup } = this.currentDrill;

    // Update dataset
    this.setAttribute('data-date', params.date);
    this.setAttribute('data-variant', String(params.variant));
    this.setAttribute('data-strings', String(params.strings));
    this.setAttribute('data-skip', String(params.skip));

    // Update stepper & inputs
    if (this.variantBadge) this.variantBadge.textContent = `v${params.variant}`;
    if (this.prevBtn) this.prevBtn.disabled = params.variant <= 1;

    // Update Meta summary
    if (this.metaSummary) {
      const modeLabel = params.skip ? 'String-Skipping' : 'Adjacent';
      const seedHex = `0x${seed.toString(16).padStart(8, '0')}`;
      this.metaSummary.textContent = `${params.date} (v${params.variant}) — ${params.strings} Strings — ${modeLabel} — Seed: ${seedHex}`;
    }

    // Update Warmup fretboard & cards
    if (this.warmupFretboard) {
      this.warmupFretboard.innerHTML = renderWarmupFretboardSvg(params.strings);
    }
    if (this.warmupGrid) {
      this.warmupGrid.innerHTML = renderWarmupCards(warmup, params.strings);
    }

    // Update Twister systems & tab
    if (this.twisterSystems) {
      this.twisterSystems.innerHTML = renderTwisterSystems(this.currentDrill);
    }
    if (this.twisterTabCode) {
      this.twisterTabCode.textContent = formatSpiderexAsciiTab(this.currentDrill);
    }

    // Update URL query params without page reload
    if (updateUrl && typeof window !== 'undefined' && window.history) {
      const searchParams = new URLSearchParams({
        date: params.date,
        variant: String(params.variant),
        strings: String(params.strings),
        skip: params.skip ? '1' : '0',
      });
      window.history.replaceState(null, '', `?${searchParams.toString()}`);
    }

    // Announce status change for screen readers
    if (this.statusEl) {
      const mode = params.skip ? 'string-skipping' : 'adjacent';
      this.statusEl.textContent = `Spiderex drill updated: ${params.date}, variant ${params.variant}, ${params.strings} strings, ${mode}.`;
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('spiderex-trainer')) {
  customElements.define('spiderex-trainer', SpiderexTrainerElement);
}
