import { Controller } from '@hotwired/stimulus';
import { RNG } from 'rot-js';

// Data Model

type Position = 1 | 2 | 3 | 4;

type Pattern = [Position, Position, Position, Position];

interface Config {
  strings: number;
  permutations: Pattern[];
}

// Date Helpers

function parseDate(candidate: string) {
  if (!candidate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return;
  }

  const date: Date = new Date(candidate);

  if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== candidate) {
    return;
  }

  return candidate;
}

function getTodayDate() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000).toISOString().slice(0, 10);
}

// Controller

const dateParamName = 'date';

export default class SpiderexController extends Controller {
  static targets = ['query', 'warmupResults', 'twisterResults'];

  private static singleton: SpiderexController;

  declare warmupResultsTarget: Element;
  declare twisterResultsTarget: Element;

  private date?: string;

  initialize() {
    if (SpiderexController.singleton) {
      throw new ReferenceError('spiderex-controller is a singleton and should only be initialized once');
    }
    SpiderexController.singleton = this;

    const searchParams = new URLSearchParams(window.location.search);
    const dateParam = searchParams.get(dateParamName);

    if (dateParam) {
      this.date = parseDate(dateParam);
    }

    if (this.date === undefined) {
      // Reload with today's date
      searchParams.set(dateParamName, getTodayDate());
      window.location.search = searchParams.toString();
      return;
    }
  }

  queryTargetConnected(target: Element) {
    if (!(target instanceof HTMLInputElement)) {
      throw new TypeError("spiderex-controller target 'query' must be a valid HTMLInputElement");
    }

    if (!this.date) {
      return;
    }

    target.value = this.date;
  }

  async connect() {
    if (!this.date) {
      return;
    }

    const config: Config = await (await fetch('/assets/spiderex.json')).json();
    const patternLength = config.permutations[0].length;
    const patterns: Pattern[][] = new Array(patternLength);

    for (let i = 0; i < patternLength; ++i) {
      patterns[i] = [];
    }

    for (const pattern of config.permutations) {
      patterns[pattern[0] - 1].push(pattern);
    }

    RNG.setSeed(parseInt(this.date.replace(/-/g, '')));

    const warmupPatterns: Pattern[] = [];

    for (let i = 0; i < patterns.length; ++i) {
      warmupPatterns.push(RNG.getItem(RNG.shuffle(patterns[i])) as Pattern);
    }

    const list = document.createElement('ul');

    for (const pattern of warmupPatterns) {
      const item = document.createElement('li');
      item.innerHTML = `<pre>${pattern.join('')}</pre>`;
      list.appendChild(item);
    }

    this.warmupResultsTarget.appendChild(list);

    const twisterTablature: string[] = new Array(config.strings);

    for (let i = 0; i < config.strings; ++i) {
      switch (i) {
        case 0:
        case 5:
          twisterTablature[i] = 'E|-';
          break;
        case 1:
        case 6:
          twisterTablature[i] = 'B|-';
          break;
        case 2:
          twisterTablature[i] = 'G|-';
          break;
        case 3:
          twisterTablature[i] = 'D|-';
          break;
        case 4:
          twisterTablature[i] = 'A|-';
      }
    }

    for (const twisterPattern of RNG.shuffle([
      ...warmupPatterns,
      ...warmupPatterns,
      ...warmupPatterns,
      ...warmupPatterns
    ])) {
      for (const position of twisterPattern) {
        const string = RNG.getUniformInt(0, config.strings - 1);

        for (let i = 0; i < config.strings; ++i) {
          twisterTablature[i] += i === string ? position.toString() : '-';
        }
      }
    }

    this.twisterResultsTarget.innerHTML = `<pre>${twisterTablature.join('\n')}</pre>`;
  }
}
