'use strict'

const Client = require('instagram-private-api').V1;
const request = require('request');
const fs = require('fs');

const Draft = require('models/draft');
const Users = require('models/users');

const device = new Client.Device('bukagaleri');
const storage = new Client.CookieFileStorage(`${__app}cookies/bukagaleri.json`);

module.exports = (() => {
  const igLogin = (callback) => {
    Client.Session.create(device, storage, process.env.IG_USERNAME, process.env.IG_PASSWORD).then((session) => {
      callback(session);
    });
  }

  const download = (uri, filename, callback) => {
    request.head(uri, (err, res, body) => {
      request(uri).pipe(fs.createWriteStream(filename)).on('close', callback);
    });
  }

  const posting = (ref) => {
    if (ref._draftPool.length && ref._session) {
      const selectedDraft = ref._draftPool[0];
      const userId = selectedDraft.userId;
      const caption = selectedDraft.caption;
      const imageUrl = selectedDraft.url;
      const width = selectedDraft.width;
      const height = selectedDraft.height;

      Client.Account.getById(ref._session, userId).then((result) => {
        const username = result._params.username;
        const copyrightedCaption = `${caption.replace(/\n+$/g, '')}\n.\n.\n.\n\ud83d\udcf7 @${username}`;
        return [copyrightedCaption, username];
      }).spread((copyrightedCaption, username) => {
        const filename = `${__root}tmp/${imageUrl.split('/').pop()}`;
        download(imageUrl, filename, () => {
          console.log('done downloading ', filename);
          ref._draftPool.shift().remove();
          Client.Upload.photo(ref._session, filename).then((upload) => {
        		return Client.Media.configurePhoto(ref._session, upload.params.uploadId, copyrightedCaption, width, height);
            console.log('done uploading ', filename);
        	}).then((medium) => {
            fs.unlink(filename, () => {
              console.log('done removing ', filename);
            });
          });
        });
      });
    };
  }

  const populateDraft = (ref) => {
    if (!ref._draftPool.length) {
      Draft.find({}, (err, draft) => {
        if (err) throw err;
        console.log('Draft refill...\n');
        this._draftPool = draft;
      });
    };
  }

  const routine = (command, interval, ...args) => {
    command.apply(this, args);
    setInterval(() => {
      command.apply(this, args);
    }, interval);
  }

  return {
    run: () => {
      this._session = null;
      this._draftPool = [];

      igLogin((session) => {
        this._session = session;
      });

      routine(populateDraft, process.env.POSTER_POPULATE_DRAFT || 60 * 1000, this);
      routine(posting, process.env.POSTER_POSTING || 30 * 1000, this);
    }
  };
})();
