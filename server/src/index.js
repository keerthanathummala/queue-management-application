import { createApp } from './app.js';
import { config } from './config.js';
import { load } from './db.js';

load();
createApp().listen(config.port, () => {
  console.log(`Queue server listening on http://localhost:${config.port}`);
});
