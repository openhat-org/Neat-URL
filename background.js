// Sources:
// * First version from Pure URL
// * https://cheeky4n6monkey.blogspot.nl/2014/10/google-eid.html
// * https://greasyfork.org/en/scripts/10096-general-url-cleaner
// * https://webapps.stackexchange.com/questions/9863/are-the-parameters-for-www-youtube-com-watch-documented
// * https://github.com/Smile4ever/firefoxaddons/issues/25
// * https://github.com/Smile4ever/firefoxaddons/issues/43

/// Static variables
let defaultRequestTypes = ["main_frame"];
let defaultBlacklist = []; // google-analytics.com, sb.scorecardresearch.com, doubleclick.net, beacon.krxd.net"
let suffixList = new Array();

/// Runtime setting
let enabled = true;

/// Used by addons.mozilla.org handling
let globalNeatURL = "";
let globalCurrentURL = "";
let globalTabId = -1;

/// Badge and browserAction (the variable version is also used for upgrades)
let badge = []; // Hold the badge counts
let version = browser.runtime.getManifest().version;

/// Preferences
let neat_url_default_blocked_params; // Exception: this is not editable and doesn't come out of storage local!
let neat_url_override_default_blocked_params;
let neat_url_blocked_params;
let neat_url_blacklist;
let neat_url_icon_animation; // none, missing_underscore, rotate or surprise_me
let neat_url_icon_theme;
let neat_url_show_counter;
let neat_url_counter_color;
let neat_url_logging;
let neat_url_types;

// Used for upgrading purposes:
let neat_url_version; // previous version when upgrading, after upgrading the current version

function init(){
	let valueOrDefault = function(value, defaultValue){
		if(value == undefined) return defaultValue;
		return value;
	}
	
	let valueOrDefaultArray = function(value, defaultValue){
		if(value == undefined || value == "") return defaultValue;

		return value.split(" ").join("").split(",");
	}
	
	browser.storage.local.get([
		"neat_url_override_default_blocked_params",
		"neat_url_blocked_params",
		"neat_url_icon_animation",
		"neat_url_icon_theme",
		"neat_url_show_counter",
		"neat_url_counter_color",
		"neat_url_logging",
		"neat_url_blacklist",
		"neat_url_types",
		"neat_url_counter_default_color",
		"neat_url_version"
	]).then((storageLocalResult) => {
		neat_url_override_default_blocked_params = valueOrDefaultArray(storageLocalResult.neat_url_override_default_blocked_params, []);
		neat_url_blocked_params = valueOrDefaultArray(storageLocalResult.neat_url_blocked_params, []);
		neat_url_icon_animation = valueOrDefault(storageLocalResult.neat_url_icon_animation, "missing_underscore");
		neat_url_icon_theme = valueOrDefault(storageLocalResult.neat_url_icon_theme, "dark");
		neat_url_show_counter = valueOrDefault(storageLocalResult.neat_url_show_counter, true);
		neat_url_counter_color = valueOrDefault(storageLocalResult.neat_url_counter_color, "#000000");
		neat_url_logging = valueOrDefault(storageLocalResult.neat_url_logging, false);
		neat_url_blacklist = valueOrDefaultArray(storageLocalResult.neat_url_blacklist, defaultBlacklist);
		neat_url_types = valueOrDefaultArray(storageLocalResult.neat_url_types, defaultRequestTypes);
		neat_url_counter_default_color = valueOrDefault(storageLocalResult.neat_url_counter_default_color, true); // true as default
		neat_url_version = valueOrDefault(storageLocalResult.neat_url_version, "0.1.0");
		
		// Upgrade configuration from old releases
		if(neat_url_counter_default_color == null && neat_url_counter_color == "#eeeeee"){
			// Update counter_color to null
			browser.storage.local.set({ neat_url_counter_color: null });

			// Update counter_default_color to true
			browser.storage.local.set({ neat_url_counter_default_color: true }); // not strictly needed, but this shouldn't hurt either

			// Do not use any color
			neat_url_counter_default_color = true;
		}

		if(!neat_url_counter_default_color)
			browser.browserAction.setBadgeBackgroundColor({color: neat_url_counter_color});

		// Re-initialise listener, hopefully fixes https://github.com/Smile4ever/firefoxaddons/issues/92
		browser.webRequest.onBeforeRequest.removeListener(cleanURL);
		if(neat_url_types.length != 0){
			/// Register for types specified in neat_url_types
			browser.webRequest.onBeforeRequest.addListener(
				cleanURL,
				{urls: ["<all_urls>"], types: neat_url_types},
				["blocking"]
			);
		}
	
		initBrowserAction(); // needs neat_url_icon_theme
		initCounter(); // needs neat_url_show_counter
		deleteDefaultParametersFromBlockedParameters(); // needs neat_url_icon_theme and neat_url_blocked_params

		return storageLocalResult;
	})
	// Retrieve default parameters from JSON file and set neat_url_blocked_params
	.catch(console.error);
	
	fetch('data/default-params-by-category.json').then((response) => {
		return response.json();
	}).then((jsonParams) => {
		neat_url_default_blocked_params = jsonParams.categories.flatMap(cat => cat.params);
	});

	fetch('data/publicsuffix-ccSLD.txt').then((response) => {
		return response.text();		
	}).then((text) => {
		suffixList = text.split("\n");
	});

	initContextMenus();
}
init();

///Messages
// listen for messages from the content or options script
browser.runtime.onMessage.addListener(function(message) {
	switch (message.action) {
		case "refresh-options":
			init();
			break;
		case "notify":
			notify(message.data);
			break;
		default:
			break;
	}
});

/// Browser action
/// Neat URL code
function initBrowserAction(){
	browser.browserAction.setIcon({path: resolveIconURL("neaturl-96-state0.png")});
	browser.browserAction.setTitle({title: "Neat URL " + version + " - enabled"});

	browser.browserAction.onClicked.addListener((tab) => {
		enabled = !enabled;

		if(enabled){
			browser.browserAction.setIcon({path: resolveIconURL("neaturl-96-state0.png")});
			browser.browserAction.setTitle({title: "Neat URL " + version + " - enabled"});
		}
		else{
			browser.browserAction.setIcon({path: resolveIconURL("neaturl-96-state0_disabled.png")});
			browser.browserAction.setTitle({title: "Neat URL " + version + " - disabled"});
		}
	});
}

/// Context menus
function initContextMenus(){
	browser.contextMenus.onClicked.removeListener(listener);
	browser.contextMenus.removeAll().catch(null);
	
	createContextMenu("neaturl-tb-preferences", "Preferences", ["browser_action"]);
	browser.contextMenus.onClicked.addListener(listener);
}

function createContextMenu(id, title, contexts){
	browser.contextMenus.create({
		id: id,
		title: title,
		contexts: contexts
	});
}

/// Translate Now / Lean URL code
function listener(info, tab){
	if(info.menuItemId == "neaturl-tb-preferences"){
		browser.runtime.openOptionsPage();
		return;
	}
}

/// Neat URL code
function deleteDefaultParametersFromBlockedParameters(){
// Delete all parameters from the user storage that are already contained in the default parameters
// The default parameters will be editable, but only the offset will be saved
// That makes future updates easier

	let oldVersion = neat_url_version;
	let newVersion = browser.runtime.getManifest().version;
	// Upgrade value in browser.storage.local if oldVersion != newVersion
	oldVersion = "1.0.0";
	if(oldVersion != newVersion){
		let changes = false;
		let defaultParams = neat_url_default_blocked_params;
		
		for(let defaultParam of defaultParams){
			if(defaultParam.endsWith("_*")){
				let paramToFind = defaultParam.replace("_*", "_");
				let lengthBefore = neat_url_blocked_params.length;
				neat_url_blocked_params = neat_url_blocked_params.filter((blocked) => !blocked.startsWith(paramToFind));
				let lengthAfter = neat_url_blocked_params.length;

				if(lengthAfter != lengthBefore){
					changes = true;
				}
			}

			if(neat_url_blocked_params.includes(defaultParam)){
				neat_url_blocked_params = removeFromArray(neat_url_blocked_params, defaultParam);
				changes = true;
			}
		}

		if(changes){
			browser.storage.local.set({"neat_url_blocked_params": neat_url_blocked_params.join(', ')})
		}

		browser.storage.local.set({"neat_url_version": newVersion});
	}
}

function removeFromArray(array, item){
	var index = array.indexOf(item);
	if (index > -1) {
		array.splice(index, 1);
	}

	return array;
}

/// Neat URL code
function removeEndings(leanURL, endingParams){
	let isSearch = leanURL.search == "" ? false : true ;
	let path = leanURL.pathname;

	for(let endingParam of endingParams){
		path = applyMatch(endingParam, isSearch, path);
	}

	if(leanURL.pathname != path){
		leanURL.pathname = path;
		leanURL.search = "";//should be empty before or removed right now by $$
	}
	return leanURL;
}

function applyMatch(match2, isSearch, leanURL){
	let secondChar = match2.substr(1, 1);
	let startIndexAsEnd = -1;

	// /dp/ is for Amazon product pages
	if(!isSearch || secondChar == "$" || leanURL.includes("/dp/")){
		// Check it twice
		if(match2.indexOf("$") == 0) match2 = match2.substring(1);
		if(match2.indexOf("$") == 0) match2 = match2.substring(1);

		startIndexAsEnd = leanURL.lastIndexOf(match2);
		//console.log("[Neat URL]: startIndexAsEnd is " + startIndexAsEnd + " inside of " + leanURL + " for " + match2);

		// if startIndexAsEnd is -1, we return the original URL without altering it
		if(startIndexAsEnd > -1)
			leanURL = leanURL.substring(0, startIndexAsEnd);
	}

	return leanURL;
}

function getParameterForDomainUrl(gbp, domain, rootDomain, domainMinusSuffix, detailsUrl){
	if (!gbp.includes("@")) {
		return gbp;
	}

	// Workaround for https://github.com/Smile4ever/firefoxaddons/issues/76
	if (gbp == "gws_rd@google.*" && rootDomain == "google.com" && detailsUrl.searchParams.get("gws_rd") == "cr"){
		return "";
	}

	let keyValue, keyDomain, index;
	index = gbp.indexOf('@');
	[keyValue, keyDomain] = [gbp.slice(0,index), gbp.slice(index+1)];

	// Root wildcard domain, so compare with root domain
	if(keyDomain.startsWith("*.")){
		keyDomain = keyDomain.replace("*.", "");
		if ( rootDomain == keyDomain ) {
			//console.log("[Neat URL]: matching to root domain");
			return keyValue;
		}
	}

	// Suffix wildcard domain
	if(keyDomain.endsWith(".*")){
		//console.log("[Neat URL]: keyDomain " + keyDomain + " ends with .* - domainMinusSuffix is " + domainMinusSuffix);
		keyDomain = keyDomain.replace(".*", "");

		if (domainMinusSuffix == keyDomain) {
			//console.log("[Neat URL]: matching to wildcard domain");
			return keyValue;
		}
	}

	// Double wildcards
	if(keyDomain.startsWith("*.") && keyDomain.endsWith(".*")){
		keyDomain = keyDomain.replace("*.", "");
		keyDomain = keyDomain.replace(".*", "");
		if ( rootDomain == keyDomain && domainMinusSuffix == keyDomain) {
			//console.log("[Neat URL]: matching to root wildcard and suffix wildcard domain");
			return keyValue;
		}
	}

	if(domain == keyDomain) {
		//console.log("[Neat URL]: matching to domain " + domain + " for " + detailsUrl);
		return keyValue;
	}

	//console.log("[Neat URL]: not matching to domain " + domain + " with keyDomain " + keyDomain);
	return "";
}

/// Lean URL code
function buildURL(url, blockedParams, hashParams) {
	if (blockedParams.length == 0 && hashParams.length == 0) {
		return url;
	}

	/// Process wildcards parameters
	for(let blockedParam of blockedParams){
		// Wildcard support :)
		// utm_*
		let wildcardParam = getWildcardParam(blockedParam);
		if(wildcardParam != "")	url = deleteWildcardParam(wildcardParam, url);
	}

	/// Replace hash params
	let hashUrl = new URL(url.href);
	hashUrl.search = hashUrl.hash.replace('#', '');
	hashUrl.hash = '';

	let searchParamsBefore = hashUrl.href;

	for(let hashParam of hashParams){
		//this will remove one, exact, hashParam
		if(hashParam == url.hash || hashParam == "#*" || hashParam == "#?*"){
			url.hash = "";
			return url;
		}

		/// Do something special!
		// https://github.com/Smile4ever/firefoxaddons/issues/83
		// #?utm_source
		// Example URL: http://www.cuisineactuelle.fr/recettes/mini-burgers-au-foie-gras-331523#utm_source=Facebook&utm_medium=social&utm_campaign=PassionApero
		if (hashParam.startsWith('#?')) {
			let specialHashParam = hashParam.replace('#?', '');
			if(neat_url_logging) console.log("[Neat URL]: buildURL - found hash parameter " + hashParam);

			// Wildcard support :)
			// utm_*
			let wildcardParam = getWildcardParam(specialHashParam);
			if(wildcardParam != "")	hashUrl = deleteWildcardParam(wildcardParam, hashUrl);

			// utm_source
			hashUrl.searchParams.delete(specialHashParam);
		}
	}

	// Stringify from URL object adds = to the other parameters without value, sadly.
	// In most cases this won't be a problem, if it is there will be bugs about it
	// Workaround to above encoding issue: only use the new value if the length is less now
	if(searchParamsBefore.length > hashUrl.href.length){
		const newHash = hashUrl.search.replace('?', '');
		url.hash = newHash ? `#${newHash}` : '';
	}

	return url;
}

function getWildcardParam(param){
	let wildcardIndex = param.indexOf("*");

	let wildcard = wildcardIndex > -1;
	let isLastChar = wildcardIndex == param.length - 1;

	if(!wildcard || !isLastChar) return "";
	return param.substring(0, wildcardIndex);
}

function deleteWildcardParam(wildcardParam, url){
	for(let key of url.searchParams.keys()){
		if(key.startsWith(wildcardParam)){
			// Match! We should remove this parameter.
			// Here be dragons ;)
			if(neat_url_logging) console.log("[Neat URL]: buildURL - found wildcard parameter " + key + " for " + wildcardParam);
			url.searchParams.delete(key);
		}
	}

	return url;
}

function getDomainMinusSuffix(domain){
	// Single or double domain
	let substringDomainExtension = domain.substring(domain.indexOf(".") + 1);
	let substringBeforeDomainExtension = domain.substring(0, domain.indexOf("."));

	if(suffixList.includes(substringDomainExtension))
	{
		return substringBeforeDomainExtension;
	}
	
	// Fallback scenario
	let lastIndex = domain.lastIndexOf(".");
	let previousLastIndex = domain.lastIndexOf(".", lastIndex - 1);

	if(lastIndex - previousLastIndex < 4){
		lastIndex = previousLastIndex;
	}

	return domain.substring(0, lastIndex);
}

/// Neat URL code
// Copied from https://stackoverflow.com/questions/8498592/extract-hostname-name-from-string
function getRootDomain(domain) {
	if(domain == undefined || domain == null) return null;

	let splitArr = domain.split('.'),
		arrLen = splitArr.length;

	// grep -e '^[a-zA-Z]\{2,3\}\.[a-zA-Z]\{2,3\}$' publicsuffix.txt > publicsuffix-ccSLD.txt
	
	// Extract the root domain
	//http://publicsuffix.org/list/
	if (arrLen > 2) {
		// Checking for double domains with 3 or less characters using publicsuffix-ccSLD.txt. Fixes support *.jd.com for https://item.jd.com
		if(splitArr[arrLen - 2].length <= 3){
			var toCheck = splitArr[arrLen - 2] + '.' + splitArr[arrLen - 1]; // co.uk (found) or item.jd.com (not found)
			
			if(neat_url_logging) console.log("Probably not desired: " + toCheck);
			if(neat_url_logging) console.log("Probably more desired: " + splitArr[arrLen - 3] + '.' + splitArr[arrLen - 2] + '.' + splitArr[arrLen - 1]);
			
			if(suffixList.includes(toCheck)){
				// Example URLs that trigger this code path are https://images.google.co.uk and https://google.co.uk
				if(neat_url_logging) console.log(toCheck + " found in the list!");

				domain = splitArr[arrLen - 3] + '.' + splitArr[arrLen - 2] + '.' + splitArr[arrLen - 1];
			}else{
				if(neat_url_logging) console.log(toCheck + " not found in the list!");
				domain = splitArr[arrLen - 2] + '.' + splitArr[arrLen - 1];
			}
		
		}else{
			domain = splitArr[arrLen - 2] + '.' + splitArr[arrLen - 1];
		}
	}

	return domain;
}

/// Lean URL / Neat URL code
function cleanURL(details) {
	if(!enabled) return;

	let url = new URL(details.url);
	let domain = url.hostname;
	let originalDetailsUrl = details.url;

	// Do not change links for these domains
	for(let blackDomain of neat_url_blacklist){
		if(domain.endsWith(blackDomain)){
			if(neat_url_logging) console.log(`[Neat URL]: not rewriting '${url.href}'`);
			return;
		}
	}

	domain = domain.replace(/^www\./i, '');//getDomain() -> //leave www out of this discussion. I don't consider this a subdomain
	let rootDomain = getRootDomain(domain);
	let domainMinusSuffix = getDomainMinusSuffix(domain);

	if (domain == null || rootDomain == null || domainMinusSuffix == null ){
		return;
	}	

	let blockedParams = [];
	let hashParams = [];
	let endingParams = []
	let excludeParams = [];

	let defaultBlockedParamsWithoutOverrides = neat_url_default_blocked_params.filter((defaultBlockedParam) => !neat_url_override_default_blocked_params.includes(defaultBlockedParam));
	let allBlockedParams = defaultBlockedParamsWithoutOverrides.concat(neat_url_blocked_params);

	for (let gbp of allBlockedParams) {
		let match = getParameterForDomainUrl(gbp, domain, rootDomain, domainMinusSuffix, url);
		if(match === "") continue;

		// Hash params
		if(match.startsWith("#")){
			if(neat_url_logging) console.log(`[Neat URL]: hash param '${match}' matches (for domain)`);
			hashParams.push(match);
			continue;
		}
		
		// Ending params
		if(match.startsWith("$")){
			if(neat_url_logging) console.log(`[Neat URL]: ending param '${match}' matches (for domain)`);
			endingParams.push(match);
			continue;
		}

		// Excludes
		if(match.startsWith("!")){
			if(neat_url_logging) console.log(`[Neat URL]: exclude param '${match}' matches (for domain)`);
			excludeParams.push(match);
			continue;
		}

		blockedParams.push(match);
	}
	
	for(let excludeParam of excludeParams){
		blockedParams = removeFromArray(blockedParams, excludeParam.replace("!", ""));
	}

	//! ?a=1&a=2 is valid
	// keys must be removed in reverse,
	// because, when first is removed, third is moved to second position
	let forparams = new URL(url);//or... make copy
	for (let key of forparams.searchParams.keys()) {
		//console.log(`[Neat URL]: if includes(${key})`)
		if (blockedParams.includes(key)) {
			//console.log(`[Neat URL]: delete(${key})`)
			url.searchParams.delete(key);
		}
	}

	// https://github.com/Smile4ever/firefoxaddons/issues/30 should no longer occur with the new buildURL function
	// https://github.com/Smile4ever/firefoxaddons/issues/47 should be solved as well
	leanURL = buildURL(url, blockedParams, hashParams);
	leanURL = removeEndings(leanURL, endingParams);

	// Is the URL changed?
	if(new URL(originalDetailsUrl).href == leanURL.href) return;

	if(neat_url_logging) console.log(`[Neat URL]: (type ${details.type}): '${originalDetailsUrl}' has been changed to '${leanURL}'`);

	const applyAfter = 1000;

	if(leanURL.hostname != "addons.mozilla.org"){
		animateToolbarIcon();
		if(neat_url_show_counter) incrementBadgeValue(details.tabId);
	} else {
		// webRequest blocking is not supported on mozilla.org, lets fix this
		// but only if we are navigating to addons.mozilla.org and there doesn't exist a tab yet with the same URL
		if(details.type != "main_frame") return;
		if(globalNeatURL == leanURL.href) return;

		globalNeatURL = leanURL.href;
		globalCurrentURL = originalDetailsUrl;
		globalTabId = details.tabId;

		setTimeout(function(){
			browser.tabs.query({url: globalCurrentURL}).then((tabs) => {
				if(globalNeatURL == null || globalNeatURL == "") return;

				if(tabs.length == 0){
					//console.log(`[Neat URL]: the query for '${globalCurrentURL}' returned nothing. Attempting '${globalNeatURL}'`);
				}else{
					//console.log(`[Neat URL]: It was opened in a new tab, update that tab to '${globalNeatURL}'`);

					for (tab of tabs) {
						if(neat_url_logging) console.log(`[Neat URL]: really updating '${tab.url}' to '${globalNeatURL}'`);
						browser.tabs.update(tab.id, { url: globalNeatURL });//May be fired more than once?
						animateToolbarIcon();
						if(neat_url_show_counter) incrementBadgeValue(globalTabId);
					}
				}

				setTimeout(() => {
					globalNeatURL = "";
					globalCurrentURL = "";
				}, applyAfter);
			}, null);
		}, applyAfter);
	}

	return { redirectUrl: leanURL.href };
}

/// Translate Now code
function notify(message){
	browser.notifications.create(message.substring(0, 20),
	{
		type: "basic",
		iconUrl: browser.extension.getURL(resolveIconUrlNotif("neaturl-96-state0.png")),
		title: "Neat URL",
		message: message
	});
}

String.prototype.replaceAll = function(search, replacement) {
	let target = this;
	return target.replace(new RegExp(search, 'g'), replacement);
};
