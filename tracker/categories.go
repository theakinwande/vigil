package tracker

import "strings"

var categoryKeywords = map[string][]string{
	"Development":   {"code", "cursor", "goland", "idea", "vim", "neovim", "windowsterminal", "wt", "postman"},
	"Browser":       {"chrome", "firefox", "msedge", "brave", "opera"},
	"Communication": {"slack", "discord", "teams", "zoom", "telegram", "whatsapp"},
	"Productivity":  {"notion", "obsidian", "excel", "word", "powerpoint", "onenote", "claude", "snippingtool"},
	"Entertainment": {"spotify", "vlc"},
	"Design":        {"figma", "photoshop", "illustrator"},
	"System": {
		"explorer", "lockapp", "shellhost", "applicationframehost", "searchhost",
		"vigil", "vigil-dev", "taskmgr", "dwm", "winlogon",
		"runtimebroker", "sihost", "ctfmon", "searchui",
	},
	"Installer": {"setup", "install", "update", "unins"},
}

// Categorize returns the category for an executable name based on keyword matching.
func Categorize(exeName string) string {
	name := strings.ToLower(exeName)
	for category, keywords := range categoryKeywords {
		for _, kw := range keywords {
			if strings.Contains(name, kw) {
				return category
			}
		}
	}
	if strings.Contains(name, "vigil") {
		return "System"
	}
	return "Uncategorized"
}
