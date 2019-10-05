var CLIENT_ID = "client_id";
var CLIENT_SECRET = "client_secret";
var REFRESH_TOKEN = "refresh_token";
var GITHUB_TOKEN = "github_token";

var DEPLOYMENT_ID = "deployment_id";

var GITHUB_PROJECT = "github_project";
var MASTER_PROJECT = "master_project";
var MASTER_DEPLOYMENT_ID = "master_deployment_id";
var TEST_PROJECT = "test_project";
var TEST_DEPLOYMENT_ID = "test_deployment_id";

var ACCESS_TOKEN = "access_token";
var ACCESS_TOKEN_EXPIRE_TIME = "access_token_expire_time";
var TOKEN_TYPE = "token_type";

function getGoogleAccessToken() {
    var scriptProperties = PropertiesService.getScriptProperties();

    var tokenExpireTime = scriptProperties.getProperty(ACCESS_TOKEN_EXPIRE_TIME);
    var token = scriptProperties.getProperty(ACCESS_TOKEN);

    if (token == null || tokenExpireTime == null || new Date() >= new Date(tokenExpireTime)) {
        // acquire new token
        var clientId = scriptProperties.getProperty(CLIENT_ID);
        var clientSecret = scriptProperties.getProperty(CLIENT_SECRET);
        var refreshToken = scriptProperties.getProperty(REFRESH_TOKEN);

        var response = UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v4/token', {
            'method': 'post',
            'payload': {
                'client_id': clientId,
                'client_secret': clientSecret,
                'refresh_token': refreshToken,
                'grant_type': 'refresh_token'
            }
        });
        var data = JSON.parse(response.getContentText());

        var newAccessToken = data["access_token"];
        var expiresIn = data["expires_in"];
        var tokenType = data["token_type"];

        scriptProperties.setProperty(ACCESS_TOKEN, newAccessToken);
        scriptProperties.setProperty(TOKEN_TYPE, tokenType);

        var expireTime = new Date(Date.now() + parseInt(expiresIn)).toISOString();
        scriptProperties.setProperty(ACCESS_TOKEN_EXPIRE_TIME, expireTime);

        token = newAccessToken;
    }

    return token;
}

function getProjectFiles(projectId) {
    var scriptProperties = PropertiesService.getScriptProperties();
    var projectContentUrl = "https://script.googleapis.com/v1/projects/" + projectId + "/content";

    var tokenType = scriptProperties.getProperty(TOKEN_TYPE);
    var token = getGoogleAccessToken();

    var response = UrlFetchApp.fetch(projectContentUrl, {
        headers: {
            'Authorization': tokenType + " " + token
        }
    });
    return JSON.parse(response.getContentText());
}

function updateProjectFiles(projectId, branch) {
    var scriptProperties = PropertiesService.getScriptProperties();

    var githubProject = scriptProperties.getProperty(GITHUB_PROJECT);
    var githubFiles = getFilesFromGithub(githubProject, branch);

    var projectFiles = getProjectFiles(projectId);
    var names = [];
    for (var i = 0; i < projectFiles.files.length; ++i) {
        var file = projectFiles.files[i];
        if (file.name in githubFiles) file.source = githubFiles[file.name].source;
        names.push(file.name);
    }

    // New file
    var githubFileKeys = Object.keys(githubFiles);
    for (var i = 0; i < githubFileKeys.length; ++i) {
        var key = githubFileKeys[i];
        var githubFile = githubFiles[key];

        if (names.indexOf(key) === -1) {
            projectFiles.files.push(githubFile);
        }
    }

    var projectContentUrl = "https://script.googleapis.com/v1/projects/" + projectId + "/content";

    var tokenType = scriptProperties.getProperty(TOKEN_TYPE);
    var token = getGoogleAccessToken();

    var response = UrlFetchApp.fetch(projectContentUrl, {
        headers: {'Authorization': tokenType + " " + token, 'Content-Type': 'text/plain'},
        method: 'put',
        payload: JSON.stringify(projectFiles)
    });
    var data = JSON.parse(response.getContentText());

    return data;
}

function getFilesFromGithub(githubProject, branch) {
    branch = branch || 'master'; // default branch

    var scriptProperties = PropertiesService.getScriptProperties();

    var githubUrl = "https://api.github.com/repos/" + githubProject + "/contents?ref=" + branch;
    var githubToken = scriptProperties.getProperty(GITHUB_TOKEN);

    var response;
    if (githubToken) {
        response = UrlFetchApp.fetch(githubUrl, {
            headers: {'Authorization': "token " + githubToken, 'Accept': 'application/vnd.github.v3+json'}
        });
    }
    else {
        response = UrlFetchApp.fetch(githubUrl);
    }
    var data = JSON.parse(response.getContentText());

    var files = {};
    for (var i = 0; i < data.length; ++i) {
        var file = data[i];

        var fileName = file.name;
        var fileUrl = file.download_url;

        fileName = fileName.substr(0, fileName.indexOf('.'));

        var fileContent = UrlFetchApp.fetch(fileUrl).getContentText();
        files[fileName] = {
            "name": fileName,
            "type": "SERVER_JS",
            "source": fileContent,
            "lastModifyUser": {
                "domain": "google.com",
                "email": "github.sync.bot@google.com",
                "name": "github sync bot",
                "photoUrl": ""
            },
            "createTime": new Date().toISOString(),
            "updateTime": new Date().toISOString(),
            "functionSet": {}
        };
    }

    return files;
}

function deployProject(projectId, deploymentId) {
    var response;
    var scriptProperties = PropertiesService.getScriptProperties();

    var tokenType = scriptProperties.getProperty(TOKEN_TYPE);
    var token = getGoogleAccessToken();

    // create new version
    response = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects/" + projectId + "/versions", {
        headers: {'Authorization': tokenType + " " + token},
        method: 'post'
    });
    var versionNumber = JSON.parse(response.getContentText()).versionNumber;

    // deploy new version
    var deployUrl = "https://script.googleapis.com/v1/projects/" + projectId + "/deployments/" + deploymentId;
    UrlFetchApp.fetch(deployUrl, {
        headers: {'Authorization': tokenType + " " + token, 'Content-Type': 'text/plain'},
        method: 'put',
        payload: JSON.stringify({
            "deploymentConfig": {
                "versionNumber": versionNumber
            }
        })
    });
}

function doPost(request) {
    var projectId, branch;
    var scriptProperties = PropertiesService.getScriptProperties();
    var deploymentId;

    // master server
    projectId = scriptProperties.getProperty(MASTER_PROJECT);
    deploymentId = scriptProperties.getProperty(MASTER_DEPLOYMENT_ID);
    if (projectId) {
        updateProjectFiles(projectId);
        deployProject(projectId, deploymentId);
    }

    // test server
    projectId = scriptProperties.getProperty(TEST_PROJECT);
    deploymentId = scriptProperties.getProperty(TEST_DEPLOYMENT_ID);
    if (projectId) {
        branch = 'test';
        updateProjectFiles(projectId, branch);
        deployProject(projectId, deploymentId);
    }
}