var fs = require('fs');
var raf = require('random-access-file');
var res_api = require('../res/res_api');

var downloaders = {};  // node 环境中保存所有downloader
global.downloaders = downloaders;

var forwardDownloader = require('./forward').forwardDownloader;
var peerjsDownloader = require('./peerDownloader').peerjsDownloader;
var settings = require('./settings');

var DOWNLOAD_OVER = settings.DownloadState['DOWNLOAD_OVER'],
    DOWNLOADING = settings.DownloadState['DOWNLOADING'],
    CANCELED = settings.DownloadState['CANCELED'],
    PAUSED = settings.DownloadState['PAUSED'],
    DOWNLOAD_ERR = settings.DownloadState['DOWNLOAD_ERR'],
    ALREADY_COMPLETE = settings.DownloadState['ALREADY_COMPLETE'];

var browserWindow;
exports.initWindow = function(window) {
  browserWindow = window;
};

function v4Downloader(fileInfo, my_uid, uploader_uids, e,
        downloadOverCallback, downloadProgressCallback) {
  this.innerDownloader = new peerjsDownloader(fileInfo);
  this.hash = fileInfo.hash;
  this.size = fileInfo.size;
  this.file_to_save = fileInfo.file_to_save;
  this.file_to_save_tmp = fileInfo.file_to_save + '.tmp';
  this.uploaderUidList = uploader_uids.split(',');
  this.descriptor = raf(this.file_to_save_tmp);
  this.complete_parts = 0;
  this.total_parts = parseInt((fileInfo.size+settings.partsize-1)/settings.partsize);
  this.e = e;
  this.downloadOverCallback = downloadOverCallback;
  this.downloadProgressCallback = downloadProgressCallback;
  this.states = {
    status: DOWNLOADING,
    progress: 0,
    error: null
  };
}

v4Downloader.prototype.startFileDownload = function(parts_left) {
  // update v4Downloader's state in innerDownloader
  this.innerDownloader.startFileDownload(parts_left);
};

v4Downloader.prototype.pauseFileDownload = function() {
  this.states.status = PAUSED;
  this.innerDownloader.pauseFileDownload(this.states);
};

v4Downloader.prototype.resumeFileDownload = function() {
  this.states.status = DOWNLOADING;
  this.innerDownloader.resumeFileDownload(this.states);
};

v4Downloader.prototype.cancelFileDownload = function() {
  this.states.status = CANCELED;
  this.innerDownloader.cancelFileDownload(this.states);
  if (fs.existsSync(this.file_to_save_tmp)) {
    fs.unlinkSync(this.file_to_save_tmp);
  }
  // TODO: update nedb
};

v4Downloader.prototype.useForward = function() {
  // can't use Peerjs so use forward mode
  // TODO: safe delete this.innerDownloader, simple delete may leak memory
  delete this.innerDownloader;
  this.innerDownloader = new forwardDownloader(
    this.fileInfo,
    this.my_uid,
    this.uploaderUidList,
    this.e,
    this.downloadOverCallback,
    this.downloadProgressCallback
  );
  this.innerDownloader.startFileDownload();
};

exports.downloadFile = function(fileInfo, my_uid, uploader_uids,
                                e, downloadOverCallback, downloadProgressCallback) {
  var d = new v4Downloader(
    fileInfo,   // {size, hash, file_to_save}
    my_uid,
    uploader_uids,
    e,
    downloadOverCallback,
    downloadProgressCallback
  );
  downloaders[fileInfo.hash] = d;
  var parts_left = null;
  var hash = parseInt(d.hash);
  global.parts_left_collection.findOne(
    {hash: parseInt(hash)},
    function(err, doc) {
      if (err) {
        browserWindow.console.log(err);
      }
      if (doc) {  // parts_left表中有对应项
        parts_left = doc.parts_left;
        // 检测文件是否已存在,如果已存在,并且没有剩余part,认为下载已完成
        if (fs.existsSync(d.file_to_save) || fs.existsSync(d.file_to_save_tmp)){
          if (parts_left.length === 0) {
            browserWindow.console.log("already complete");
            d.complete_parts = d.total_parts;
            // TODO: call downloadOverCallback
          } else { //文件已存在,且没有下载完成,进入【断点续传】模式
            browserWindow.console.log("resume unfinished downloading");
            browserWindow.console.log("parts_left: ", parts_left);
            d.complete_parts = d.total_parts - parts_left.length;
            d.startFileDownload(parts_left);
          }
        }
        else {// 如果文件实际上不存在,则认为是一个全新下载,并更新parts_left表对应项
          browserWindow.console.log("file does not exist, redownload file");
          parts_left.length = 0;  // better way to make parts_left = []
          for (var i = 0; i < d.total_parts; i++) {
            parts_left.push(i);
          }
          res_api.update_parts_left(hash, parts_left);
          d.startFileDownload(parts_left);
        }
      } else { // 之前没有下载过这个文件
        browserWindow.console.log("new download");
        parts_left = [];
        for (i = 0; i < d.total_parts; i++) {
          parts_left.push(i); // 全新的下载, parts_left为所有的parts
        }
        res_api.update_parts_left(hash, parts_left);
        d.startFileDownload(parts_left);
      }
    }
  );
};

exports.pauseFileDownload = function(hash) {
  downloaders[hash].pauseFileDownload();
};

exports.resumeFileDownload = function(hash) {
  downloaders[hash].resumeFileDownload();
};

exports.cancelFileDownload = function(hash) {
  downloaders[hash].cancelFileDownload();
  // TODO: clear downloaders
};
