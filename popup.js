var signin = function (callback) {
    chrome.identity.getAuthToken({interactive: true}, callback);
};

function onGoogleLibraryLoaded() {
    signin(authorizationCallback);
}

var authorizationCallback = function (data) {
    gapi.auth.setToken({access_token: data});
    gapi.client.load('gmail', 'v1', function () {
        gapi.client.load('drive', 'v2', processThread);
    });
};

function getHashFromUrl(url) {
    return url.substr(url.lastIndexOf("#") + 1);
}
var getMessageIdFromUrl = function (url) {
    var hash = getHashFromUrl(url);
    return hash.substr(hash.lastIndexOf("/") + 1);
};

function parseBase64(contentInBase64) {
    return atob(contentInBase64.replace(/\-/g, "+").replace(/_/g, "/"));
}

function arrayBufferToBase64(buffer) {
    var binary = ''
    var bytes = new Uint8Array(buffer)
    var len = bytes.byteLength;
    for (var i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[ i ])
    }
    return window.btoa(binary);
}

function getContentFromMessage(message) {
    //Take the first part with text/html type, or text/plain
    var firstHtmlContent, firstPlainTextContent;
    for (var i = 0; i < message.payload.parts.length; i++) {
        var part = message.payload.parts[i];
        if (part.mimeType == "text/html") {
            firstHtmlContent = part.body.data;
            break;
        } else if (part.mimeType == "text/plain") {
            firstPlainTextContent = part.body.data;
        }
    }

    var contentInBase64 = firstHtmlContent ? firstHtmlContent : firstPlainTextContent;
    return parseBase64(contentInBase64);
}

function deleteFile(id) {
    gapi.client.drive.files.delete({ 'fileId': id}).execute(function (data) {
        console.log(data)
    });
}
function createDraftEmail(attachment) {
    return 'Subject:\n' +
        'MIME-Version: 1.0\n' +
        'Content-Type: multipart/mixed; boundary="----=_Part_0_1557435007.1403835997405"\n' +
        '\n' +
        '------=_Part_0_1557435007.1403835997405\n' +
        'Content-Type: text/html; charset="UTF-8"\n' +
        '\n' +
        'Here is your file\n' +
        '------=_Part_0_1557435007.1403835997405\n' +
        'Content-Type: application/pdf; name="email.pdf"\n' +
        'Content-Transfer-Encoding: base64\n' +
        'Content-Disposition: attachment; filename=email.pdf\n' +
        '\n' +
        attachment +
        '\n' +
        '------=_Part_0_1557435007.1403835997405--'
}

function createDraftWithAttachment(linkToPDF, callback) {
    //Download the PDF
    var oReq = new XMLHttpRequest();
    oReq.open("GET", linkToPDF, true);
    oReq.responseType = "arraybuffer";

    oReq.onload = function (oEvent) {
        //Create the draft and call the callback
        var email = createDraftEmail(arrayBufferToBase64(oReq.response));
        uploadDraft(email, function (data) {
            console.log(data);
            callback(data);
        })
    };

    oReq.send();
}

/**
 * Create Draft email.
 *
 * @param  {String} userId User's email address. The special value 'me'
 * can be used to indicate the authenticated user.
 * @param  {String} email RFC 5322 formatted String.
 * @param  {Function} callback Function to call when the request is complete.
 */
function uploadDraft(email, callback) {
    var base64EncodedEmail = btoa(email);
    var payload = {
       userId: "me",
            'message': {
                'raw': base64EncodedEmail
            }
    };
    console.log(JSON.stringify(payload));
    var request = gapi.client.gmail.users.drafts.create(payload);
    request.execute(callback);
}

function processThread() {

    chrome.tabs.query({active: true, currentWindow: true}, function (data) {
        var tab = data[0];

        //get current email
        var messageId = getMessageIdFromUrl(tab.url);
        gapi.client.gmail.users.threads.get({userId: "me", id: messageId}).execute(function (thread) {
            var totalHtml = "";
            //export to pdf
            for (var i = 0; i < thread.messages.length; i++) {
                if (i > 0) {
                    totalHtml = totalHtml + "<hr>\n";
                }
                totalHtml = totalHtml + getContentFromMessage(thread.messages[i]);
            }

            insertFile("Extracted from GMail " + messageId, totalHtml, function (result) {
                console.log(result);
                createDraftWithAttachment(result.exportLinks["application/pdf"], function (draft) {
                    //open the draft in gmail window
                    console.log("new url : "+tab.url+"?compose="+draft.message.id);
                    chrome.tabs.update(tab.id, {url:tab.url+"?compose="+draft.message.id});
                    deleteFile(result.id);
                });
            });
        });
    })
}

/**
 * Insert new file.
 *
 * @param {File} fileData File object to read data from.
 * @param {Function} callback Function to call when the request is complete.
 */
function insertFile(title, htmlData, callback) {
    const boundary = '-------314159265358979323846';
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";

    var contentType = 'text/html';
    var metadata = {
        'title': title,
        'mimeType': contentType
    };

    var base64Data = btoa(htmlData);
    var multipartRequestBody =
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: ' + contentType + '\r\n' +
        'Content-Transfer-Encoding: base64\r\n' +
        '\r\n' +
        base64Data +
        close_delim;

    var request = gapi.client.request({
        'path': '/upload/drive/v2/files?convert=true',
        'method': 'POST',
        'params': {'uploadType': 'multipart'},
        'headers': {
            'Content-Type': 'multipart/mixed; boundary="' + boundary + '"'
        },
        'body': multipartRequestBody});
    if (!callback) {
        callback = function (file) {
            console.log(file)
        };
    }
    request.execute(callback);

}
