'use strict'

const Client = require('instagram-private-api').V1;
const request = require('request');
const _ = require('underscore');

const Users = require('models/users');
const Draft = require('models/draft');

const device = new Client.Device('bukagaleri');
const storage = new Client.CookieFileStorage(`${__app}cookies/bukagaleri.json`);

module.exports = (() => {

  const igLogin = (callback) => {
    Client.Session.create(device, storage, process.env.IG_USERNAME, process.env.IG_PASSWORD).then((session) => {
      callback(session);
    });
  }

  const drafting = (ref) => {
    if (ref._usersPool.length && ref._session) {
      const selectedUser = ref._usersPool[0];
      const userId = selectedUser.userId;
      const userLastDraftingTime = selectedUser.lastDraftingTime;

      const feed = new Client.Feed.UserMedia(ref._session, userId, process.env.FEED_COUNT || 10);

      feed.get().then((results) => {
        const media = _(results).filter((medium) => {
          const captionRegExp = new RegExp(`#${process.env.QUERY_TAG}`, 'gi');
          return captionRegExp.test(medium._params.caption) && userLastDraftingTime < medium._params.takenAt
        });

        const dates = media.map((n) => {
          return n._params.takenAt;
        });

        const newLastDraftingTime = dates.length ? dates.reduce((prev, curr) => Math.max(prev, curr)) : 0;

        if (newLastDraftingTime > selectedUser.lastDraftingTime) {
          selectedUser.lastDraftingTime = newLastDraftingTime;
          selectedUser.save((err, res) => {
            if (err) throw err;
            ref._usersPool.shift();
            console.log(`newLastDraftingTime of ${userId} has been updated`);
          });
        }

        if (media.length) {
          console.log(`Got ${media.length} new image(s)`);
        }

        media.forEach((item) => {
          const image = _.first(item._params.images);
          const draft = Draft();
          const captionRegExp = new RegExp(`#${process.env.QUERY_TAG}`, 'gi');
          const originalWidth = item._params.originalWidth;
          const originalHeight = item._params.originalHeight;
          const originalUrl = image.url.replace(/\?.*$/g, '').split('/').map((n) => {
            return n.indexOf(`${image.width}x`) != -1 ? 'original' : n
          }).join('/');

          Object.assign(draft, {
            draft, url: originalUrl,
            userId: userId,
            caption: item._params.caption.replace(captionRegExp, ''),
            date: item._params.takenAt,
            width: originalWidth,
            height: originalHeight
          });
          draft.save((err, res) => {
            if (err) throw err;
          });
        });
      }).catch((e) => {
        const user = ref._usersPool.shift();
        console.log(`Error ${e.name} from ${user.id}`);
        if (e.name == 'PrivateUserError') {
          return Client.Relationship.create(ref._session, user.userId);
        }
      });
    }
  }

  const populateUsers = (ref) => {
    if (!ref._usersPool.length) {
      Users.find({username: {$exists:true}}, (err, users) => {
        if (err) throw err;
        console.log('Users refill...\n');
        this._usersPool = users;
      });
    }
  }

  const routine = (command, interval, ...args) => {
    setInterval(() => {
      command.apply(this, args);
    }, interval);
  }

  return {
    run: () => {
      this._session = null;
      this._usersPool = [];

      igLogin((session) => {
        this._session = session;
      })

      routine(populateUsers, process.env.COLLECT_POPULATE_USER || 49 * 1000, this);
      routine(drafting, process.env.COLLECT_DRAFTING || 43 * 1000, this);
    }
  }
})();
