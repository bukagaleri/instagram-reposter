'use strict'

const Client = require('instagram-private-api').V1;
const request = require('request');
const _ = require('underscore');

const Users = require('models/users');
const Draft = require('models/draft');

const device = new Client.Device('bukagaleri');
const storage = new Client.CookieMemoryStorage();

module.exports = (() => {

  const getExtraArguments = (media) => {
    const mediaType = media.mediaType;

    const extraArgumentsSwitcher = {
      1: () => {
        return {}
      },
      2: () => {
        return {
          previewUrl: getMediaUrl(Object.assign({}, media, {mediaType: 1})),
          durationms: media.videoDuration * 1000
        };
      }
    }

    return JSON.stringify(extraArgumentsSwitcher[mediaType]());
  }

  const getMediaUrl = (media) => {
    const mediaTypeUrlSwitcher = {
      1: () => {
        const image = _.first(media.images);
        const splittedUrl = image.url.replace(/\?.*$/g, '').split('/');
        return splittedUrl.splice(0, 3).concat(['original', ...splittedUrl.splice(-1)]).join('/');
      },
      2: () => {
        const video = _.first(media.videos);
        const splittedUrl = video.url.replace(/\?.*$/g, '').split('/')
        return splittedUrl.splice(0, 3).concat(['original', ...splittedUrl.splice(-1)]).join('/');
      }
    }
    return mediaTypeUrlSwitcher[media.mediaType].call(this)
  }

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

      console.log(`Try to collect from ${selectedUser.username}`);

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
        } else {
          ref._usersPool.shift();
        }

        if (media.length) {
          console.log(`Got ${media.length} new media`);
        }

        media.forEach((item) => {
          const itemId = item.id;
          const draft = Draft();
          const captionRegExp = new RegExp(`#${process.env.QUERY_TAG}`, 'gi');
          const originalWidth = item._params.originalWidth;
          const originalHeight = item._params.originalHeight;
          const mediaType = item._params.mediaType;

          const originalUrl = getMediaUrl(item._params);
          const extraArguments = getExtraArguments(item._params);

          Object.assign(draft, {
            url: originalUrl,
            extraArguments: extraArguments,
            userId: userId,
            caption: item._params.caption.replace(captionRegExp, ''),
            date: item._params.takenAt,
            width: originalWidth,
            height: originalHeight,
            mediaType: mediaType
          });

          draft.save((err, res) => {
            if (err) throw err;
            Client.Like.create(ref._session, itemId);
          });
        });
      }).catch((e) => {
        const user = ref._usersPool.shift();
        console.log(`Error from ${selectedUser.username}: `, e);
        if (e.name == 'PrivateUserError') {
          return Client.Relationship.create(ref._session, user.userId);
        }
      });
    }
  }

  const populateUsers = (ref) => {
    if (!ref._usersPool.length) {
      Users.find({username: {$exists:true}, active: { $ne: false }}, (err, users) => {
        if (err) throw err;
        console.log('Users refill...\n');
        this._usersPool = users;
      });
    }
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
      this._usersPool = [];

      igLogin((session) => {
        this._session = session;
      })

      routine(populateUsers, process.env.COLLECT_POPULATE_USER || 49 * 1000, this);
      routine(drafting, process.env.COLLECT_DRAFTING || 43 * 1000, this);
    }
  }
})();
