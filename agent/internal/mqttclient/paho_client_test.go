package mqttclient

import "testing"

func TestNormalizeBrokerURL(t *testing.T) {
	testCases := []struct {
		name      string
		input     string
		want      string
		wantError bool
	}{
		{
			name:  "converts mqtt scheme to tcp",
			input: "mqtt://localhost:1883",
			want:  "tcp://localhost:1883",
		},
		{
			name:  "converts mqtts scheme to ssl",
			input: "mqtts://broker.example.com:8883",
			want:  "ssl://broker.example.com:8883",
		},
		{
			name:  "keeps tcp scheme",
			input: "tcp://broker.example.com:1883",
			want:  "tcp://broker.example.com:1883",
		},
		{
			name:      "rejects missing host",
			input:     "mqtt://",
			wantError: true,
		},
		{
			name:      "rejects unsupported scheme",
			input:     "http://broker.example.com:1883",
			wantError: true,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			got, err := normalizeBrokerURL(testCase.input)
			if testCase.wantError {
				if err == nil {
					t.Fatalf("expected error, got broker url %q", got)
				}

				return
			}

			if err != nil {
				t.Fatalf("normalizeBrokerURL returned error: %v", err)
			}

			if got != testCase.want {
				t.Fatalf("expected %q, got %q", testCase.want, got)
			}
		})
	}
}

func TestNewPahoClientRejectsEmptyCredentialFields(t *testing.T) {
	_, err := NewPahoClient(Config{
		BrokerURL: "mqtt://localhost:1883",
		ClientID:  "",
		Username:  "user",
		Password:  "pass",
	})
	if err == nil {
		t.Fatal("expected error for empty client id")
	}

	_, err = NewPahoClient(Config{
		BrokerURL: "mqtt://localhost:1883",
		ClientID:  "agent-1",
		Username:  "",
		Password:  "pass",
	})
	if err == nil {
		t.Fatal("expected error for empty username")
	}

	_, err = NewPahoClient(Config{
		BrokerURL: "mqtt://localhost:1883",
		ClientID:  "agent-1",
		Username:  "user",
		Password:  "",
	})
	if err == nil {
		t.Fatal("expected error for empty password")
	}
}
