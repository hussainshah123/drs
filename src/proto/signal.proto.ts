/**
 * DRS signalling protocol, protocol version 1.1.
 *
 * This is the wire contract between the agent (this app) and the Signalling
 * Gateway (C2), ported from Desktop-Remote-Solution/proto/drs/signal/v1/signal.proto.
 * We embed it as a string and parse it at runtime with protobufjs reflection so
 * the app needs no code-generation step.
 *
 * google.protobuf.Timestamp is declared locally (seconds=1, nanos=2) so the
 * definition is self-contained; the wire format is identical to the well-known
 * type, so it stays compatible with the Go gateway.
 */
export const SIGNAL_PROTO = `
syntax = "proto3";
package drs.signal.v1;

message Timestamp {
  int64 seconds = 1;
  int32 nanos = 2;
}

message SignalMessage {
  uint64 seq = 1;
  uint64 reply_to = 2;
  Timestamp sent_at = 3;

  oneof payload {
    Register register = 10;
    Registered registered = 11;
    Error error = 12;
    TokenRefresh token_refresh = 13;

    Heartbeat heartbeat = 20;
    PresenceUpdate presence_update = 21;
    InventoryReport inventory_report = 22;
    Telemetry telemetry = 23;
    PresenceSubscribe presence_subscribe = 24;

    SessionOffer session_offer = 30;
    SessionAnswer session_answer = 31;
    IceCandidate ice_candidate = 32;
    TransportReport transport_report = 33;

    ParticipantJoin participant_join = 40;
    ParticipantLeave participant_leave = 41;
    ParticipantRoleChange participant_role_change = 42;
    PermissionGrant permission_grant = 43;
    ConsentRequest consent_request = 44;
    ConsentResponse consent_response = 45;
    RekeyRequest rekey_request = 46;
    SessionEnded session_ended = 47;

    Command command = 60;
    CommandAck command_ack = 61;
    CommandResult command_result = 62;
    CommandCancel command_cancel = 63;

    Message message = 70;
    MessageAck message_ack = 71;

    CredentialDelivery credential_delivery = 80;
    CredentialDeliveryAck credential_delivery_ack = 81;
  }
}

message Register {
  oneof credential {
    string device_token = 1;
    string participant_token = 2;
    string access_token = 3;
  }
  string protocol_version = 4;
  ClientInfo client = 5;
  AgentState agent_state = 6;
}

message ClientInfo {
  ClientType type = 1;
  string version = 2;
  Platform platform = 3;
  string os_version = 4;
  string user_agent = 5;
}

message AgentState {
  string hostname = 1;
  string last_user = 2;
  repeated string mac_addresses = 3;
  repeated string ip_cidrs = 4;
  int64 inventory_ver = 5;
  repeated string running_command_keys = 6;
}

message Registered {
  string connection_id = 1;
  string tenant_id = 2;
  Timestamp server_time = 3;
  uint32 heartbeat_interval_seconds = 4;
  Timestamp token_expires_at = 5;
  string protocol_version = 6;

  oneof identity {
    AgentIdentity agent = 10;
    ParticipantIdentity participant = 11;
    OperatorIdentity operator = 12;
  }
}

message AgentIdentity {
  string device_id = 1;
  bool inventory_requested = 2;
}

message ParticipantIdentity {
  int64 participant_id = 1;
  SessionInfo session = 2;
  int64 permissions = 3;
}

message OperatorIdentity {
  string user_id = 1;
}

message TokenRefresh {
  string token = 1;
}

message Error {
  string code = 1;
  string message = 2;
  string request_id = 3;
}

message Heartbeat {
  string last_user = 1;
  repeated string active_session_ids = 2;
  uint64 uptime_seconds = 3;
}

message PresenceSubscribe {
  repeated string device_ids = 1;
  string group_id = 2;
}

message PresenceUpdate {
  string device_id = 1;
  bool online = 2;
  string last_user = 3;
  string active_session_id = 4;
  Timestamp last_seen_at = 5;
}

message InventoryReport {
  int64 inventory_ver = 1;
  bytes hardware_json = 2;
  bytes software_json = 3;
  bytes services_json = 4;
  Timestamp collected_at = 5;
}

message Telemetry {
  map<string, double> metrics = 1;
  bytes compliance_json = 2;
  string thumbnail_s3_key = 3;
}

message Endpoint {
  oneof kind {
    int64 participant_id = 1;
    string device_id = 2;
  }
}

message SessionOffer {
  string session_id = 1;
  Endpoint from = 2;
  Endpoint to = 3;
  string sdp = 4;
  bool ice_restart = 5;
}

message SessionAnswer {
  string session_id = 1;
  Endpoint from = 2;
  Endpoint to = 3;
  string sdp = 4;
}

message IceCandidate {
  string session_id = 1;
  Endpoint from = 2;
  Endpoint to = 3;
  string candidate = 4;
  string sdp_mid = 5;
  uint32 sdp_mline_index = 6;
  string username_fragment = 7;
  bool end_of_candidates = 8;
}

message TransportReport {
  string session_id = 1;
  Transport transport = 2;
  string local_candidate_type = 3;
  string remote_candidate_type = 4;
}

message SessionInfo {
  string session_id = 1;
  SessionKind kind = 2;
  ControlMode control_mode = 3;
  string device_id = 4;
  bytes device_public_key = 5;
  int64 ceiling = 6;
  repeated Participant participants = 7;
}

message Participant {
  int64 participant_id = 1;
  ParticipantKind kind = 2;
  ParticipantRole role = 3;
  string display_name = 4;
  string user_id = 5;
  int64 permissions = 6;
  ClientType client = 7;
  Timestamp joined_at = 8;
}

message ParticipantJoin {
  string session_id = 1;
  Participant participant = 2;
  SessionInfo session = 3;
  string audit_ref = 4;
}

message ParticipantLeave {
  string session_id = 1;
  int64 participant_id = 2;
  LeaveReason reason = 3;
  bool rekey = 4;
}

message ParticipantRoleChange {
  string session_id = 1;
  int64 participant_id = 2;
  ParticipantRole role = 3;
  int64 permissions = 4;
  bool rekey = 5;
}

message PermissionGrant {
  string session_id = 1;
  int64 participant_id = 2;
  int64 permissions = 3;
}

message ConsentRequest {
  string request_id = 1;
  string session_id = 2;
  Participant participant = 3;
  int64 requested_permissions = 4;
  string tenant_name = 5;
  uint32 timeout_seconds = 6;
}

message ConsentResponse {
  string request_id = 1;
  bool granted = 2;
  int64 granted_permissions = 3;
}

message RekeyRequest {
  string session_id = 1;
  string reason = 2;
}

message SessionEnded {
  string session_id = 1;
  string reason = 2;
  string ended_by = 3;
}

message Command {
  int64 command_id = 1;
  string idempotency_key = 2;
  CommandKind kind = 3;
  bytes payload_json = 4;
  string toolbox_version_id = 5;
  string session_id = 6;
  bool run_elevated = 7;
  Timestamp not_before = 8;
  Timestamp expires_at = 9;
}

message CommandAck {
  int64 command_id = 1;
  string idempotency_key = 2;
  AckState state = 3;
  string error_detail = 4;

  enum AckState {
    ACK_STATE_UNSPECIFIED = 0;
    ACK_STATE_RECEIVED = 1;
    ACK_STATE_RUNNING = 2;
    ACK_STATE_REJECTED = 3;
    ACK_STATE_DUPLICATE = 4;
  }
}

message CommandResult {
  int64 command_id = 1;
  string idempotency_key = 2;
  CommandStatus status = 3;
  int32 exit_code = 4;
  string output = 5;
  string output_s3_key = 6;
  string error_detail = 7;
  Timestamp started_at = 8;
  Timestamp finished_at = 9;
}

message CommandCancel {
  int64 command_id = 1;
  string idempotency_key = 2;
}

message Message {
  int64 message_id = 1;
  MessageKind kind = 2;
  bytes body_json = 3;
  string template_id = 4;
  string sender_name = 5;
  Timestamp expires_at = 6;
}

message MessageAck {
  int64 message_id = 1;
  MessageStatus status = 2;
}

message CredentialDelivery {
  string delivery_id = 1;
  string session_id = 2;
  CredentialTarget target = 3;
  bytes sealed = 4;
  bytes ephemeral_public_key = 5;
  bool inject_only = 6;
}

message CredentialDeliveryAck {
  string delivery_id = 1;
  bool delivered = 2;
  string error_detail = 3;
}

enum Platform {
  PLATFORM_UNSPECIFIED = 0;
  PLATFORM_WINDOWS = 1;
  PLATFORM_MACOS = 2;
  PLATFORM_LINUX = 3;
  PLATFORM_ANDROID = 4;
  PLATFORM_IOS = 5;
}

enum ClientType {
  CLIENT_TYPE_UNSPECIFIED = 0;
  CLIENT_TYPE_PORTAL = 1;
  CLIENT_TYPE_MOBILE_PORTAL = 2;
  CLIENT_TYPE_GUEST_WEB = 3;
  CLIENT_TYPE_AGENT = 4;
}

enum SessionKind {
  SESSION_KIND_UNSPECIFIED = 0;
  SESSION_KIND_SUPPORT = 1;
  SESSION_KIND_MEETING = 2;
  SESSION_KIND_ACCESS = 3;
}

enum ControlMode {
  CONTROL_MODE_UNSPECIFIED = 0;
  CONTROL_MODE_FULL = 1;
  CONTROL_MODE_VIEW_STEALTH = 2;
  CONTROL_MODE_INPUT_LOCK = 3;
  CONTROL_MODE_ANNOTATE = 4;
  CONTROL_MODE_PARALLEL = 5;
  CONTROL_MODE_BACKSTAGE = 6;
  CONTROL_MODE_CAMERA = 7;
}

enum Transport {
  TRANSPORT_UNSPECIFIED = 0;
  TRANSPORT_WEBRTC_P2P = 1;
  TRANSPORT_RELAY = 2;
  TRANSPORT_SFU = 3;
  TRANSPORT_BRIDGE = 4;
}

enum ParticipantKind {
  PARTICIPANT_KIND_UNSPECIFIED = 0;
  PARTICIPANT_KIND_HOST = 1;
  PARTICIPANT_KIND_GUEST = 2;
}

enum ParticipantRole {
  PARTICIPANT_ROLE_UNSPECIFIED = 0;
  PARTICIPANT_ROLE_OWNER = 1;
  PARTICIPANT_ROLE_CO_HOST = 2;
  PARTICIPANT_ROLE_PRESENTER = 3;
  PARTICIPANT_ROLE_VIEWER = 4;
}

enum LeaveReason {
  LEAVE_REASON_UNSPECIFIED = 0;
  LEAVE_REASON_LEFT = 1;
  LEAVE_REASON_REMOVED = 2;
  LEAVE_REASON_DISCONNECTED = 3;
  LEAVE_REASON_TRANSFERRED = 4;
  LEAVE_REASON_REVOKED = 5;
}

enum CommandKind {
  COMMAND_KIND_UNSPECIFIED = 0;
  COMMAND_KIND_RUN_TOOL = 1;
  COMMAND_KIND_RUN_COMMAND = 2;
  COMMAND_KIND_REFRESH_INFO = 3;
  COMMAND_KIND_WAKE_ON_LAN = 4;
  COMMAND_KIND_REBOOT = 5;
  COMMAND_KIND_REBOOT_SAFE_MODE = 6;
  COMMAND_KIND_SHUTDOWN = 7;
  COMMAND_KIND_LOCK = 8;
  COMMAND_KIND_LOGOFF = 9;
  COMMAND_KIND_REINSTALL_AGENT = 10;
  COMMAND_KIND_UPDATE_AGENT = 11;
  COMMAND_KIND_UNINSTALL_AGENT = 12;
  COMMAND_KIND_EPHEMERAL_ADMIN = 13;
  COMMAND_KIND_PATCH_SCAN = 14;
  COMMAND_KIND_PATCH_INSTALL = 15;
  COMMAND_KIND_PATCH_ROLLBACK = 16;
  COMMAND_KIND_MDM_WIPE = 17;
  COMMAND_KIND_MDM_SELECTIVE_WIPE = 18;
  COMMAND_KIND_MDM_INSTALL_PROFILE = 19;
  COMMAND_KIND_MDM_REMOVE_PROFILE = 20;
  COMMAND_KIND_MDM_INSTALL_APP = 21;
  COMMAND_KIND_MDM_REMOVE_APP = 22;
  COMMAND_KIND_MDM_LOCK = 23;
  COMMAND_KIND_MDM_LOCATE = 24;
}

enum CommandStatus {
  COMMAND_STATUS_UNSPECIFIED = 0;
  COMMAND_STATUS_SUCCEEDED = 1;
  COMMAND_STATUS_FAILED = 2;
  COMMAND_STATUS_TIMEOUT = 3;
  COMMAND_STATUS_CANCELLED = 4;
  COMMAND_STATUS_EXPIRED = 5;
}

enum MessageKind {
  MESSAGE_KIND_UNSPECIFIED = 0;
  MESSAGE_KIND_CHAT = 1;
  MESSAGE_KIND_BANNER = 2;
  MESSAGE_KIND_TRAY = 3;
  MESSAGE_KIND_FULLSCREEN = 4;
}

enum MessageStatus {
  MESSAGE_STATUS_UNSPECIFIED = 0;
  MESSAGE_STATUS_DELIVERED = 1;
  MESSAGE_STATUS_READ = 2;
  MESSAGE_STATUS_ACKNOWLEDGED = 3;
  MESSAGE_STATUS_DISMISSED = 4;
}

enum CredentialTarget {
  CREDENTIAL_TARGET_UNSPECIFIED = 0;
  CREDENTIAL_TARGET_LOGON = 1;
  CREDENTIAL_TARGET_UAC = 2;
  CREDENTIAL_TARGET_RUN_AS = 3;
}
`;
