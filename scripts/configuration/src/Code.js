/**
 * Entry point placeholder for the configuration Apps Script project.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Configuration')
    .addItem('Open configuration', 'openConfiguration')
    .addToUi();
}

function openConfiguration() {
  SpreadsheetApp.getUi().alert('Configuration script is connected.');
}
