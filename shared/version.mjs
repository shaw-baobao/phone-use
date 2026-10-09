import packageInfo from '../package.json' with { type: 'json' };
export const version = packageInfo.version;
export const resourceUri = `ui://phone-use/panel-${version}.html`;
