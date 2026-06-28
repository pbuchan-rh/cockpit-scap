import React from 'react';
import { createRoot } from 'react-dom/client';

import "cockpit-dark-theme";
import { App } from './app.jsx';
import "@patternfly/patternfly/patternfly-base.css";
import "patternfly/patternfly-6-cockpit.scss";
import './app.scss';

document.addEventListener("DOMContentLoaded", () => {
    createRoot(document.getElementById("app")).render(<App />);
});
