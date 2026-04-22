package reminder

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/gen2brain/beeep"
)

// Reminder nags the user to take a break after a configurable interval of activity.
type Reminder struct {
	mu        sync.Mutex
	interval  time.Duration
	lastBreak time.Time

	active atomic.Bool

	stop chan struct{}
}

// New creates a Reminder with the given break interval in minutes.
func New(intervalMins int) *Reminder {
	r := &Reminder{
		interval:  time.Duration(intervalMins) * time.Minute,
		lastBreak: time.Now(),
		stop:      make(chan struct{}),
	}
	r.active.Store(true)
	return r
}

// Start launches the background ticker goroutine.
func (r *Reminder) Start() {
	go r.loop()
}

// Stop halts the ticker goroutine.
func (r *Reminder) Stop() {
	select {
	case <-r.stop:
	default:
		close(r.stop)
	}
}

// Reset treats now as the start of a fresh working stretch.
func (r *Reminder) Reset() {
	r.mu.Lock()
	r.lastBreak = time.Now()
	r.mu.Unlock()
}

func (r *Reminder) Enable()  { r.Reset(); r.active.Store(true) }
func (r *Reminder) Disable() { r.active.Store(false) }

// SetInterval updates the break interval (in minutes) and resets the clock.
func (r *Reminder) SetInterval(mins int) {
	r.mu.Lock()
	r.interval = time.Duration(mins) * time.Minute
	r.lastBreak = time.Now()
	r.mu.Unlock()
}

func (r *Reminder) loop() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-r.stop:
			return
		case <-ticker.C:
			if !r.active.Load() {
				continue
			}
			r.mu.Lock()
			due := time.Since(r.lastBreak) >= r.interval
			r.mu.Unlock()
			if !due {
				continue
			}
			_ = beeep.Notify("Vigil — take a break", "You've been at it a while. Rest your eyes.", "")
			r.Reset()
		}
	}
}
