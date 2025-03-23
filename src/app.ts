import { Application } from '@hotwired/stimulus';
import { definitionsFromContext } from '@hotwired/stimulus-webpack-helpers';

import './styles/app.scss';

window.Stimulus = Application.start();
const context = require.context('./controllers', true, /\.ts$/);
Stimulus.load(definitionsFromContext(context));
