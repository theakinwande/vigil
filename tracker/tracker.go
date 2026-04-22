package tracker

import (
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	processQueryLimitedInformation = 0x1000
)

var (
	procGetForegroundWindow       = user32.NewProc("GetForegroundWindow")
	procGetWindowThreadProcessId  = user32.NewProc("GetWindowThreadProcessId")
	procOpenProcess               = kernel32.NewProc("OpenProcess")
	procQueryFullProcessImageName = kernel32.NewProc("QueryFullProcessImageNameW")
	procCloseHandle               = kernel32.NewProc("CloseHandle")
)

// Session is a chunk of time the user spent in one app.
type Session struct {
	AppName   string
	ExePath   string
	Category  string
	Duration  int64     // seconds
	StartedAt time.Time // when this stretch began
}

// RecordFunc persists a session.
type RecordFunc func(Session) error

// CategoryFunc looks up a category for an exe name (may honor user overrides).
type CategoryFunc func(exeName string) string

type Tracker struct {
	paused atomic.Bool

	mu          sync.Mutex
	currentApp  string
	currentPath string
	switchTime  time.Time

	record      RecordFunc
	getCategory CategoryFunc

	idleThreshold time.Duration
	wasIdle       bool

	stop chan struct{}
	done chan struct{}
}

// New creates a Tracker. record is called on every flush; getCategory resolves
// an exe to a category (override-aware).
func New(record RecordFunc, getCategory CategoryFunc) *Tracker {
	if getCategory == nil {
		getCategory = Categorize
	}
	return &Tracker{
		record:      record,
		getCategory: getCategory,
		stop:        make(chan struct{}),
		done:        make(chan struct{}),
	}
}

// Start launches the polling goroutine. Safe to call once.
func (t *Tracker) Start(idleThreshold time.Duration) {
	t.idleThreshold = idleThreshold
	go t.loop()
}

// Stop signals the loop to exit and waits for it.
func (t *Tracker) Stop() {
	select {
	case <-t.stop:
	default:
		close(t.stop)
	}
	<-t.done
}

func (t *Tracker) Pause()         { t.Flush(); t.paused.Store(true) }
func (t *Tracker) Resume()        { t.mu.Lock(); t.switchTime = time.Now(); t.mu.Unlock(); t.paused.Store(false) }
func (t *Tracker) IsPaused() bool { return t.paused.Load() }

// Flush writes any pending in-memory session to the DB.
func (t *Tracker) Flush() {
	t.mu.Lock()
	app := t.currentApp
	path := t.currentPath
	start := t.switchTime
	if app == "" || start.IsZero() {
		t.mu.Unlock()
		return
	}
	dur := int64(time.Since(start).Seconds())
	t.switchTime = time.Now()
	t.mu.Unlock()
	if dur <= 0 || t.record == nil {
		return
	}
	_ = t.record(Session{
		AppName:   app,
		ExePath:   path,
		Category:  t.getCategory(app),
		Duration:  dur,
		StartedAt: start,
	})
}

func (t *Tracker) loop() {
	defer close(t.done)
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-t.stop:
			t.Flush()
			return
		case <-ticker.C:
			t.tick()
		}
	}
}

func (t *Tracker) tick() {
	if t.paused.Load() {
		return
	}
	if IsIdle(t.idleThreshold) {
		if !t.wasIdle {
			t.Flush()
			t.wasIdle = true
			t.mu.Lock()
			t.currentApp = ""
			t.currentPath = ""
			t.switchTime = time.Time{}
			t.mu.Unlock()
		}
		return
	}
	t.wasIdle = false

	exePath, ok := activeWindowExe()
	if !ok {
		return
	}
	appName := filepath.Base(exePath)

	t.mu.Lock()
	if t.currentApp == "" {
		t.currentApp = appName
		t.currentPath = exePath
		t.switchTime = time.Now()
		t.mu.Unlock()
		return
	}
	if !strings.EqualFold(t.currentApp, appName) {
		prevApp := t.currentApp
		prevPath := t.currentPath
		prevStart := t.switchTime
		dur := int64(time.Since(t.switchTime).Seconds())
		t.currentApp = appName
		t.currentPath = exePath
		t.switchTime = time.Now()
		t.mu.Unlock()
		if dur > 0 && t.record != nil {
			_ = t.record(Session{
				AppName:   prevApp,
				ExePath:   prevPath,
				Category:  t.getCategory(prevApp),
				Duration:  dur,
				StartedAt: prevStart,
			})
		}
		return
	}
	t.mu.Unlock()
}

// activeWindowExe returns the full path of the exe owning the foreground window.
func activeWindowExe() (string, bool) {
	hwnd, _, _ := procGetForegroundWindow.Call()
	if hwnd == 0 {
		return "", false
	}
	var pid uint32
	procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	if pid == 0 {
		return "", false
	}
	handle, _, _ := procOpenProcess.Call(processQueryLimitedInformation, 0, uintptr(pid))
	if handle == 0 {
		return "", false
	}
	defer procCloseHandle.Call(handle)

	buf := make([]uint16, windows.MAX_PATH)
	size := uint32(len(buf))
	r, _, _ := procQueryFullProcessImageName.Call(handle, 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)))
	if r == 0 {
		return "", false
	}
	return windows.UTF16ToString(buf[:size]), true
}
