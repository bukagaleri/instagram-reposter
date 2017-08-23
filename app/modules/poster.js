'use strict'

const Client = require('instagram-private-api').V1;
const request = require('request');
const fs = require('fs');
const Promise = require('bluebird')

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

  const download = (uri, filename) => {
    return new Promise((resolve, reject) => {
      request.head(uri, (err, res, body) => {
        request(uri).pipe(fs.createWriteStream(filename))
        .on('finish', resolve)
        .on('error', reject);
      });
    });
  }

  const uploadFunction = (ref, selectedDraft, copyrightedCaption) => {
    const mediaType = selectedDraft.mediaType;
    const mediaUrl = selectedDraft.url;

    const targetMediaFile = `${__root}tmp/${mediaUrl.split('/').pop()}`;
    const width = selectedDraft.width;
    const height = selectedDraft.height;

    const extraArguments = JSON.parse(selectedDraft.extraArguments);

    const uploadSwitcher = {
      1: () => {
        return download(mediaUrl, targetMediaFile).then(() => {
          return Client.Upload.photo(ref._session, targetMediaFile).then((upload) => {
            fs.unlink(targetMediaFile, () => console.log(targetMediaFile, 'removed'));
            return Client.Media.configurePhoto(ref._session, upload.params.uploadId, copyrightedCaption, width, height);
          });
        });
      },
      2: () => {
        const previewUrl = extraArguments.previewUrl;
        const durationms = extraArguments.durationms;
        const targetPreviewMediaFile = `${__root}tmp/${previewUrl.split('/').pop()}`;
        const promises = [];
        promises.push(download(mediaUrl, targetMediaFile));
        promises.push(download(previewUrl, targetPreviewMediaFile));

        return Promise.all(promises).then((results) => {
          return Client.Upload.video(ref._session, targetMediaFile, targetPreviewMediaFile, width, height).then((upload) => {
            fs.unlink(targetMediaFile, () => console.log(targetMediaFile, 'removed'));
            fs.unlink(targetPreviewMediaFile, () => console.log(targetPreviewMediaFile, 'removed') );
            return Client.Media.configureVideo(ref._session, upload.uploadId, copyrightedCaption, durationms);
          });
        });
      }
    }

    return uploadSwitcher[mediaType]().then((medium) => {
      ref._draftPool.shift().remove();
      Client.Like.create(ref._session, medium.id);
    });
  }

  const posting = (ref) => {
    if (ref._draftPool.length && ref._session) {
      const selectedDraft = ref._draftPool[0];
      const userId = selectedDraft.userId;
      const caption = selectedDraft.caption;

      Client.Account.getById(ref._session, userId).then((result) => {
        const username = result._params.username;
        const copyrightedCaption = `${caption.replace(/(\n|\s)+$/g, '')}\n.\n.\n.\n\ud83d\udcf7 @${username}`;
        return copyrightedCaption;
      }).then((copyrightedCaption) => {

        uploadFunction(ref, selectedDraft, copyrightedCaption);
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
