global.__root = `${__dirname}/`;
global.__app = `${__dirname}/app/`;

require('app-module-path').addPath(global.__app);
require('dotenv').load();
require('config/initializer');
require('main');
