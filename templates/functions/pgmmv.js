const vm = require('vm');

async function fetchPGMMVPluginData(identifier) {
  const latestReleaseResponse = await fetch(`https://api.github.com/repos/kidthales/${identifier}/releases/latest`);

  const releases = await (await fetch(`https://api.github.com/repos/kidthales/${identifier}/releases`)).json();
  const latestRelease = latestReleaseResponse.status !== 200 ? releases[0] : await latestReleaseResponse.json();
  const info = await fetchPluginInfo(latestRelease.assets[0].browser_download_url);

  info.parameter = normalizeParameters(info.parameter);

  info.actionCommand = info.actionCommand.map(function (ac) {
    ac.parameter = normalizeParameters(ac.parameter);
    return ac;
  });

  info.linkCondition = info.linkCondition.map(function (lc) {
    lc.parameter = normalizeParameters(lc.parameter);
    return lc;
  });

  info.description = info.description.replace(/\.$/, '');

  return { info, latestRelease, releases, repoUrl: `https://github.com/kidthales/${identifier}` };
}

async function fetchPluginInfo(url) {
  const iife = await (await fetch(url)).text();
  return vm.runInThisContext(`
      var plugin = ${iife}
      var info = {
        name: plugin.getInfo('name'),
        description: plugin.getInfo('description'),
        author: plugin.getInfo('author'),
        help: plugin.getInfo('help'),
        parameter: plugin.getInfo('parameter'),
        internal: plugin.getInfo('internal'),
        actionCommand: plugin.getInfo('actionCommand'),
        linkCondition: plugin.getInfo('linkCondition'),
      };
      info // Last expression returned
    `);
}

function normalizeParameters(parameters) {
  return parameters.map(function (param) {
    const p = {
      name: param.name.replace(`[${info.name}]`, '').trim()
    };

    switch (param.type) {
      case 'SwitchVariableObjectId':
        p.value = 'Project Common';
        param.option.forEach(function (option) {
          switch (option) {
            case 'SelfObject':
              p.value += ', Object Self';
              break;
            case 'ParentObject':
              p.value += ', Parent Object';
              break;
          }
        });
        break;
      case 'CustomId':
        p.value = param.customParam.reduce(function (v, cp) {
          v += !v ? cp.name : `, ${cp.name}`;
          return v;
        }, '');
        break;
      default:
        p.value = param.type;
        break;
    }

    return p;
  });
}

module.exports = {
  fetchPGMMVPluginData
};
