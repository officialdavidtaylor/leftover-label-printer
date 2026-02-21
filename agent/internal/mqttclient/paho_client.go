package mqttclient

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"

	"github.com/officialdavidtaylor/leftover-label-printer/agent/internal/mqttconsume"
)

const defaultDisconnectQuiesceMillis = 250

// Config provides broker connection settings for the concrete MQTT client.
type Config struct {
	BrokerURL string
	ClientID  string
	Username  string
	Password  string
}

// NewPahoClient constructs a concrete mqttconsume.Client backed by eclipse/paho.mqtt.golang.
func NewPahoClient(config Config) (mqttconsume.Client, error) {
	normalizedBrokerURL, err := normalizeBrokerURL(config.BrokerURL)
	if err != nil {
		return nil, err
	}

	clientID := strings.TrimSpace(config.ClientID)
	if clientID == "" {
		return nil, errors.New("mqtt client id must be a non-empty string")
	}

	username := strings.TrimSpace(config.Username)
	if username == "" {
		return nil, errors.New("mqtt username must be a non-empty string")
	}

	password := strings.TrimSpace(config.Password)
	if password == "" {
		return nil, errors.New("mqtt password must be a non-empty string")
	}

	return &pahoClient{
		brokerURL: normalizedBrokerURL,
		clientID:  clientID,
		username:  username,
		password:  password,
	}, nil
}

type pahoClient struct {
	brokerURL string
	clientID  string
	username  string
	password  string
}

func (client *pahoClient) Connect(ctx context.Context) (mqttconsume.Session, error) {
	connectionLost := make(chan error, 1)

	options := mqtt.NewClientOptions()
	options.AddBroker(client.brokerURL)
	options.SetClientID(client.clientID)
	options.SetUsername(client.username)
	options.SetPassword(client.password)
	options.SetAutoReconnect(false)
	options.SetConnectRetry(false)
	options.SetCleanSession(true)
	options.OnConnectionLost = func(_ mqtt.Client, err error) {
		if err == nil {
			err = errors.New("mqtt connection lost")
		}

		select {
		case connectionLost <- err:
		default:
		}
	}

	paho := mqtt.NewClient(options)

	connectToken := paho.Connect()
	if err := waitForToken(ctx, connectToken); err != nil {
		if paho.IsConnected() {
			paho.Disconnect(defaultDisconnectQuiesceMillis)
		}

		return nil, err
	}

	return &pahoSession{
		client:         paho,
		connectionLost: connectionLost,
	}, nil
}

type pahoSession struct {
	client         mqtt.Client
	connectionLost <-chan error
}

func (session *pahoSession) Subscribe(
	ctx context.Context,
	topic string,
	handler func(context.Context, []byte) error,
) error {
	subscribeToken := session.client.Subscribe(topic, 1, func(_ mqtt.Client, message mqtt.Message) {
		_ = handler(ctx, message.Payload())
	})

	return waitForToken(ctx, subscribeToken)
}

func (session *pahoSession) WaitForDisconnect(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-session.connectionLost:
		return err
	}
}

func (session *pahoSession) Close() error {
	if session.client.IsConnected() {
		session.client.Disconnect(defaultDisconnectQuiesceMillis)
	}

	return nil
}

func waitForToken(ctx context.Context, token mqtt.Token) error {
	for {
		if token.WaitTimeout(100 * time.Millisecond) {
			return token.Error()
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
	}
}

func normalizeBrokerURL(rawBrokerURL string) (string, error) {
	trimmed := strings.TrimSpace(rawBrokerURL)
	if trimmed == "" {
		return "", errors.New("mqtt broker url must be a non-empty string")
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", fmt.Errorf("invalid mqtt broker url: %w", err)
	}

	if parsed.Host == "" {
		return "", errors.New("mqtt broker url must include host")
	}

	switch parsed.Scheme {
	case "mqtt":
		parsed.Scheme = "tcp"
	case "mqtts":
		parsed.Scheme = "ssl"
	case "tcp", "ssl":
	default:
		return "", fmt.Errorf("unsupported mqtt broker url scheme %q", parsed.Scheme)
	}

	return parsed.String(), nil
}
