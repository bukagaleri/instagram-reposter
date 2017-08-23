'use strict'

const mongoose = require('mongoose')
const Schema = mongoose.Schema

module.exports = mongoose.model('draft', new Schema({
  url: String,
  userId: Number,
  caption: String,
  width: Number,
  height: Number,
  date: Number,
  mediaType: {type: Number, default: 1},
  extraArguments: {type: String, default: '{}'}
}));
