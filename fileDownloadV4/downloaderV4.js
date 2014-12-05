var fs = require('fs');
var path = require('path');
var raf = require('random-access-file');
var xxhash = require('xxhashjs');
var crc32 = require('crc-32');
var forwardDownloader = require('./forward').forwardDownloader;
var peerjsDownloader = require('./peerDownloader').peerjsDownloader;
var settings = require('./settings');

var DOWNLOAD_OVER = settings.DownloadState['DOWNLOAD_OVER'],
    DOWNLOADING = settings.DownloadState['DOWNLOADING'],
    CANCELED = settings.DownloadState['CANCELED'],
    PAUSED = settings.DownloadState['PAUSED'],
    DOWNLOAD_ERR = settings.DownloadState['DOWNLOAD_ERR'],
    ALREADY_COMPLETE = settings.DownloadState['ALREADY_COMPLETE'];

var BLOCK_SIZE = settings.BLOCK_SIZE;

var browserWindow;
exports.initWindow = function(window) {
  browserWindow = window;
};

var downloaders = {};  // node 环境中保存所有downloader


global.socket.on('receive', function(dataDOM2Node){
  var hash = dataDOM2Node.hash;
  if (crc32.buf(dataDOM2Node.content) !== dataDOM2Node.checksum) {
    browserWindow.console.log(dataDOM2Node.index, "not equal");
    global.socket.emit("downloadBlock", {index: dataDOM2Node.index, hash: hash});
    return;
  }
  downloaders[hash]['descriptor'].write(
    dataDOM2Node.index * BLOCK_SIZE,
    dataDOM2Node.content,
    function(err) {
      if (err) {
        browserWindow.console.log(err);
      }
    }
  );
});

global.socket.on("part-complete", function(hash){
  // TODO: 到底是在v4Downloader内部记录进度还是在全局的downloaders[hash]中记录?
  // 可能张洋那边是需要在内部记录的. 如果是这样, 要把blocks_left 和 complete_parts_count 挪进v4Downloader
  downloaders[hash]['complete_parts']++;
  if (downloaders[hash]['complete_parts'] === downloaders[hash]['total_parts']) {
    browserWindow.console.log("receive complete, ", Date());
    setTimeout(function(){  // 最后一个block可能还没有写入, 必须延迟一点关闭文件
      downloaders[hash]['descriptor'].close();
      if (parseInt(xxhash(0).update(fs.readFileSync('Advice.mp3')).digest()) === 473225162) {
        browserWindow.console.log("hash equal");
        browserWindow.console.log(downloaders);  // see what's inside
        browserWindow.console.log("download complete: ",
          path.basename(downloaders[hash]['path']));
        global.socket.emit("complete", hash);
      } else {
        browserWindow.console.log("hash not equal");
      }
    }, 1000);
  }
});

function v4Downloader(fileInfo, my_uid, uploader_uids, e,
        downloadOverCallback, downloadProgressCallback) {
  this.innerDownloader = new peerjsDownloader(fileInfo);
  this.fileInfo = fileInfo;
  this.my_uid = my_uid;
  this.uploaderUidList = uploader_uids.split(',');
  this.e = e;
  this.downloadOverCallback = downloadOverCallback;
  this.downloadProgressCallback = downloadProgressCallback;
  this.states = {
    status: DOWNLOADING,
    progress: 0,
    error: null
  };
}

v4Downloader.prototype.startFileDownload = function() {
  // update v4Downloader's state in innerDownloader
  this.innerDownloader.startFileDownload();
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
  downloaders[fileInfo.hash] = {};
  downloaders[fileInfo.hash]['v4Downloader'] = d;
  downloaders[fileInfo.hash]['path'] = fileInfo.file_to_save;
  downloaders[fileInfo.hash]['descriptor'] = raf(fileInfo.file_to_save);
  downloaders[fileInfo.hash]['complete_parts'] = 0;
  downloaders[fileInfo.hash]['total_parts'] =
    parseInt((fileInfo.size + settings.partsize - 1) / settings.partsize);
  d.startFileDownload();
};

exports.pauseFileDownload = function(hash) {
  downloaders[hash].pauseFileDownload();
};

exports.resumeFileDownload = function(hash) {
  downloaders[hash].resumeFileDownload();
};

exports.cancelFileDownload = function(hash) {
  downloaders[hash].cancelFileDownload();
  delete downloaders[hash];
};
