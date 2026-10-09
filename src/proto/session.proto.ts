/**
 * In-session protocol (drs.session.v1) between the viewer/portal and the agent,
 * carried end-to-end inside the session's WebRTC data channels — never seen by
 * the control plane. Ported from
 * Desktop-Remote-Solution/proto/drs/session/v1/session.proto.
 *
 * Channels (the viewer creates them in its offer):
 *   "drs.session"     ordered, reliable — every SessionMessage
 *   "drs.input.move"  unordered, maxRetransmits=0 — only PointerMove
 * Each data-channel message is one serialized SessionMessage (binary).
 *
 * The agent's first message on "drs.session" is a signed AgentHello that binds
 * the connection to the device identity; the viewer verifies it before showing
 * the stream (docs/architecture.md §1.5 step 7).
 */
export const SESSION_PROTO = `
syntax = "proto3";
package drs.session.v1;

message SessionMessage {
  uint64 seq = 1;
  oneof body {
    AgentHello agent_hello = 10;
    DisplayLayout display_layout = 11;
    CursorState cursor = 12;
    CursorShape cursor_shape = 13;
    StreamStats stats = 14;
    Notice notice = 15;
    PermissionsUpdate permissions = 16;

    InputEvent input = 30;
    Control control = 31;
  }
}

message AgentHello {
  string device_id = 1;
  string session_id = 2;
  int64 participant_id = 3;
  string dtls_fingerprint = 4;
  bytes signature = 5;
  string agent_version = 6;
  int64 permissions = 7;
}

message Display {
  uint32 id = 1;
  int32 x = 2;
  int32 y = 3;
  uint32 width = 4;
  uint32 height = 5;
  float scale = 6;
  bool primary = 7;
  string name = 8;
}

message DisplayLayout {
  repeated Display displays = 1;
  uint32 active_display_id = 2;
  uint32 stream_width = 3;
  uint32 stream_height = 4;
}

message CursorState {
  bool visible = 1;
  float x = 2;
  float y = 3;
  uint64 shape_id = 4;
}

message CursorShape {
  uint64 shape_id = 1;
  uint32 width = 2;
  uint32 height = 3;
  uint32 hotspot_x = 4;
  uint32 hotspot_y = 5;
  bytes rgba = 6;
}

message StreamStats {
  uint32 fps = 1;
  uint32 bitrate_kbps = 2;
  uint32 capture_us = 3;
  uint32 encode_us = 4;
  string encoder = 5;
}

message Notice {
  enum Level {
    LEVEL_UNSPECIFIED = 0;
    LEVEL_INFO = 1;
    LEVEL_WARNING = 2;
    LEVEL_ERROR = 3;
  }
  Level level = 1;
  string code = 2;
  string message = 3;
}

message PermissionsUpdate {
  int64 permissions = 1;
}

message InputEvent {
  oneof event {
    PointerMove pointer_move = 1;
    PointerButton pointer_button = 2;
    PointerScroll pointer_scroll = 3;
    Key key = 4;
  }
}

message PointerMove {
  float x = 1;
  float y = 2;
}

enum Button {
  BUTTON_UNSPECIFIED = 0;
  BUTTON_LEFT = 1;
  BUTTON_RIGHT = 2;
  BUTTON_MIDDLE = 3;
  BUTTON_BACK = 4;
  BUTTON_FORWARD = 5;
}

message PointerButton {
  Button button = 1;
  bool down = 2;
  float x = 3;
  float y = 4;
}

message PointerScroll {
  float dx = 1;
  float dy = 2;
  float x = 3;
  float y = 4;
}

message Key {
  uint32 hid_usage = 1;
  bool down = 2;
  bool repeat = 3;
}

message Control {
  oneof op {
    uint32 select_display = 1;
    bool request_keyframe = 2;
    bool ctrl_alt_del = 3;
    bool lock_workstation = 4;
    bool release_all = 5;
    bool pause = 6;
    bool blank_screen = 7;
  }
}
`;
