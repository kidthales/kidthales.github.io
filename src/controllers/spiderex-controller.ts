import { Controller } from '@hotwired/stimulus';

// Data Model

type Position = 1 | 2 | 3 | 4;

interface Config {
  strings: number;
  permutations: [Position, Position, Position, Position][];
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
  return new Date().toISOString().slice(0, 10);
}

// Controller

const dateParamName = 'date';

export default class SpiderexController extends Controller {
  static targets = ['query', 'warmupResults', 'stringSkipResults', 'twisterResults'];

  private static singleton: SpiderexController;

  private date?: string;

  async initialize() {
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
    console.log(this.date, config);
    // TODO
  }
}
