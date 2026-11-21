/**
 * ES Module re-export of universal modal dialogs.
 */
export const showAppConfirm = (...args) => (window.showAppConfirm ? window.showAppConfirm(...args) : Promise.resolve(false));
export const showAppAlert = (...args) => (window.showAppAlert ? window.showAppAlert(...args) : Promise.resolve());
export const showAppPrompt = (...args) => (window.showAppPrompt ? window.showAppPrompt(...args) : Promise.resolve(null));
