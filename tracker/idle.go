package tracker

import (
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32              = windows.NewLazySystemDLL("user32.dll")
	kernel32            = windows.NewLazySystemDLL("kernel32.dll")
	procGetLastInputInfo = user32.NewProc("GetLastInputInfo")
	procGetTickCount64   = kernel32.NewProc("GetTickCount64")
)

type lastInputInfo struct {
	CbSize uint32
	DwTime uint32
}

// IdleDuration returns how long the user has been idle (no keyboard/mouse input).
func IdleDuration() time.Duration {
	var info lastInputInfo
	info.CbSize = uint32(unsafe.Sizeof(info))
	r, _, _ := procGetLastInputInfo.Call(uintptr(unsafe.Pointer(&info)))
	if r == 0 {
		return 0
	}
	tick, _, _ := procGetTickCount64.Call()
	// GetTickCount64 returns uint64; last input is uint32 (wraps every ~49 days).
	// Compute diff using the low 32 bits of tick to match the input timestamp width.
	diff := uint32(tick) - info.DwTime
	return time.Duration(diff) * time.Millisecond
}

// IsIdle reports whether idle time has exceeded the threshold.
func IsIdle(threshold time.Duration) bool {
	return IdleDuration() >= threshold
}
