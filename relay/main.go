// bridge-relay: a tiny local server that passes layer data between the Figma
// plugin, the After Effects panel and Illustrator. Figma and After Effects
// talk to it over HTTP. Illustrator scripts cannot, so for Illustrator it
// passes files through the LayerBoat folder instead.
package main

import (
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const addr = "127.0.0.1:7317"

// Two mailboxes: "ae" holds what Figma sent for After Effects, "figma" holds
// what After Effects sent for Figma. Each side polls its own.
var (
	mu       sync.Mutex
	pending  = map[string][]byte{}
	lastPoll = map[string]time.Time{}
	lastSeen = time.Now()
	// whether the data waiting for Figma came from Illustrator
	fromIllustrator = false
)

func box(r *http.Request) string {
	q := r.URL.Query()
	if q.Get("for") == "figma" || q.Get("to") == "figma" {
		return "figma"
	}
	if q.Get("for") == "ai" || q.Get("to") == "ai" {
		return "ai"
	}
	return "ae"
}

// The LayerBoat folder: the relay lives in its relay folder.
func home() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	return filepath.Dir(filepath.Dir(exe))
}

// writes a file in one step, so a reader never sees half of it
func writeWhole(path string, data []byte) error {
	part := path + ".part"
	if err := os.WriteFile(part, data, 0644); err != nil {
		return err
	}
	os.Remove(path)
	return os.Rename(part, path)
}

// Illustrator leaves artwork for Figma in to-figma.json. It moves into the
// Figma mailbox, and to-figma.taken tells Illustrator once Figma has it.
func watchIllustrator(dir string) {
	src := filepath.Join(dir, "to-figma.json")
	for range time.Tick(300 * time.Millisecond) {
		data, err := os.ReadFile(src)
		if err != nil || len(data) == 0 {
			continue
		}
		os.Remove(src)
		os.Remove(filepath.Join(dir, "to-figma.taken"))
		mu.Lock()
		pending["figma"] = data
		fromIllustrator = true
		lastSeen = time.Now()
		mu.Unlock()
	}
}

// Only the Figma plugin may read from the helper in a browser. Its window has no
// origin of its own ("null"), and Figma in a browser runs at figma.com. Ordinary
// websites get no permission, so they cannot read artwork that is waiting here.
func cors(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	origin := r.Header.Get("Origin")
	if origin == "null" || origin == "https://www.figma.com" || origin == "https://figma.com" {
		h.Set("Access-Control-Allow-Origin", origin)
		h.Set("Vary", "Origin")
	}
	// browsers ask before a website may reach this computer; the plugin may
	h.Set("Access-Control-Allow-Private-Network", "true")
	h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "Content-Type")
	h.Set("Content-Type", "text/plain; charset=utf-8")
}

func touch() { mu.Lock(); lastSeen = time.Now(); mu.Unlock() }

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		cors(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		touch()
		switch r.URL.Path {
		case "/ping":
			// "/ping" reports After Effects to Figma; "/ping?from=ae" reports Figma to After Effects
			mu.Lock()
			if r.URL.Query().Get("from") == "ae" {
				alive := time.Since(lastPoll["figma"]) < 4*time.Second
				mu.Unlock()
				if alive {
					io.WriteString(w, "relay figma-connected")
				} else {
					io.WriteString(w, "relay figma-waiting")
				}
				return
			}
			alive := time.Since(lastPoll["ae"]) < 3*time.Second
			mu.Unlock()
			if alive {
				io.WriteString(w, "relay ae-connected")
			} else {
				io.WriteString(w, "relay ae-waiting")
			}
		case "/status":
			// lets the sender see whether the other side has picked the data up
			var waiting bool
			if box(r) == "ai" {
				_, err := os.Stat(filepath.Join(home(), "from-figma.svg"))
				waiting = err == nil
			} else {
				mu.Lock()
				waiting = pending[box(r)] != nil
				mu.Unlock()
			}
			if waiting {
				io.WriteString(w, "waiting")
			} else {
				io.WriteString(w, "taken")
			}
		case "/send":
			body, err := io.ReadAll(io.LimitReader(r.Body, 200<<20))
			if err != nil || len(body) == 0 {
				http.Error(w, "empty", http.StatusBadRequest)
				return
			}
			b := box(r)
			if b == "ai" {
				// Illustrator reads this file when its Bring in from Figma script runs
				if err := writeWhole(filepath.Join(home(), "from-figma.svg"), body); err != nil {
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				io.WriteString(w, "queued")
				return
			}
			mu.Lock()
			pending[b] = body
			if b == "figma" {
				fromIllustrator = false
			}
			mu.Unlock()
			io.WriteString(w, "queued")
		case "/next":
			b := box(r)
			mu.Lock()
			lastPoll[b] = time.Now()
			data := pending[b]
			pending[b] = nil
			wasAI := b == "figma" && fromIllustrator
			if b == "figma" {
				fromIllustrator = false
			}
			mu.Unlock()
			if data == nil {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			if wasAI {
				os.WriteFile(filepath.Join(home(), "to-figma.taken"), []byte("taken"), 0644)
			}
			w.Write(data)
		case "/quit":
			io.WriteString(w, "bye")
			go func() { time.Sleep(100 * time.Millisecond); os.Exit(0) }()
		default:
			io.WriteString(w, "layerboat-helper")
		}
	})
	if dir := home(); dir != "" {
		go watchIllustrator(dir)
	}
	// shut down after 2 hours with no traffic from either side
	go func() {
		for range time.Tick(time.Minute) {
			mu.Lock()
			idle := time.Since(lastSeen)
			mu.Unlock()
			if idle > 2*time.Hour {
				os.Exit(0)
			}
		}
	}()
	log.Fatal(http.ListenAndServe(addr, nil))
}
